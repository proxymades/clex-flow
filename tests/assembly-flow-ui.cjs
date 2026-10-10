/* global window, requestAnimationFrame */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLEX_BROWSER_EXECUTABLE || process.argv[2] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    window.__writes = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'clex-flow:projects:v1') window.__writes++; return setItem.call(this, key, value); };
  });
  const source = await fs.readFile('tests/fixtures/blink-mount-v2.clex.json', 'utf8');
  const stored = () => page.evaluate(() => JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
  const save = async () => { await page.getByRole('button', { name: 'Сохранить', exact: true }).first().click(); await page.getByText('Проект сохранён', { exact: true }).waitFor(); };
  const boardPort = id => page.locator('.react-flow__node-physicalBoard .assembly-handle[data-handleid="' + id + '"]');
  const componentPort = (id, terminal) => page.locator('.react-flow__node[data-id="' + id + '"] .assembly-handle[data-handleid="' + terminal + '"]');
  const drag = async (from, to) => {
    const a = await from.boundingBox(), b = await to.boundingBox();
    assert.ok(a && b);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
    await page.mouse.up();
    await page.clock.fastForward(20);
  };
  const scale = selector => page.locator(selector + ' .react-flow__viewport').evaluate(element => Number(element.style.transform.match(/scale\(([^)]+)\)/)[1]));
  try {
    await page.goto(process.env.CLEX_PREVIEW_URL || 'http://127.0.0.1:1420');
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Открыть JSON', exact: true }).click();
    await (await chooser).setFiles('tests/fixtures/blink-mount-v2.clex.json');
    await page.getByRole('button', { name: 'Монтаж', exact: true }).click();
    await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
    assert.equal(await page.locator('.react-flow__node-physicalBoard').count(), 1);
    assert.equal(await page.locator('.react-flow__node-physicalHardware').count(), 2);
    await page.locator('.physical-wire').nth(3).waitFor();
    const openedWrites = await page.evaluate(() => window.__writes);
    await page.clock.fastForward(10_500);
    assert.equal(await page.evaluate(() => window.__writes), openedWrites, 'Opening the old assembly must not rewrite its camera or project');

    const project = await stored(), led = project.components[0];
    const circle = await page.locator('.board-pin[data-pin="P34"] circle').boundingBox(), handle = await boardPort('P34').boundingBox();
    assert.ok(Math.abs(circle.x + circle.width / 2 - handle.x - handle.width / 2) < 1);
    assert.ok(Math.abs(circle.y + circle.height / 2 - handle.y - handle.height / 2) < 1, 'React Flow handle must coincide with the documented physical pin');
    const untouchedIds = project.assembly.connections.filter(wire => wire.terminalId !== 'anode').map(wire => wire.id);
    await drag(boardPort('P29'), componentPort(led.id, 'anode'));
    assert.equal(await page.locator('.breadcrumb .dirty-dot').count(), 1, 'A valid native connection must update the project');
    await save();
    let result = await stored();
    assert.equal(result.assembly.connections.find(wire => wire.componentId === led.id && wire.terminalId === 'anode').boardPinId, 'P29');
    assert.deepEqual(result.assembly.connections.filter(wire => wire.terminalId !== 'anode').map(wire => wire.id), untouchedIds);
    assert.equal(await page.getByRole('button', { name: 'Отменить соединение', exact: true }).count(), 0);
    await drag(componentPort(led.id, 'anode'), boardPort('P34')); await save();
    result = await stored();
    assert.equal(result.assembly.connections.find(wire => wire.componentId === led.id && wire.terminalId === 'anode').boardPinId, 'P34');
    assert.equal(result.formatVersion, 3); assert.equal('nodes' in result.assembly, false);
    assert.equal(result.gpioAssignments.find(item => item.componentId === led.id).gpio, 17);

    const beforeInvalid = await stored(), beforeInvalidWrites = await page.evaluate(() => window.__writes);
    await drag(boardPort('P36'), componentPort(led.id, 'anode'));
    await page.getByRole('alert').filter({ hasText: 'питанию' }).waitFor();
    await page.clock.fastForward(10_500);
    assert.deepEqual(await stored(), beforeInvalid); assert.equal(await page.evaluate(() => window.__writes), beforeInvalidWrites);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await drag(componentPort(led.id, 'anode'), componentPort(project.components[1].id, 'signal'));
    await page.getByRole('alert').filter({ hasText: 'контакт платы' }).waitFor();
    assert.deepEqual(await stored(), beforeInvalid);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();

    // Round GND handles also support the existing two-click connection workflow.
    await componentPort(led.id, 'cathode').click(); await boardPort('P28').click();
    await page.getByRole('button', { name: 'Отменить соединение', exact: true }).waitFor({ state: 'hidden' });
    const signalWire = page.getByRole('button', { name: 'Соединение Внешний светодиод 1: Анод через R → GPIO17', exact: true });
    await signalWire.press('Enter');
    await page.getByRole('button', { name: 'Удалить соединение', exact: true }).click(); await save();
    assert.equal((await stored()).assembly.connections.length, 3);
    await drag(componentPort(led.id, 'anode'), boardPort('P34')); await save();
    assert.equal((await stored()).assembly.connections.length, 4);

    // Both editors now use the same React Flow wheel normalization.
    const area = await page.locator('.assembly-flow-region').boundingBox();
    await page.mouse.move(area.x + area.width / 2, area.y + 20);
    const assemblyScale = await scale('.assembly-flow-region');
    await page.mouse.wheel(0, 40); await page.evaluate(() => new Promise(requestAnimationFrame)); await page.clock.fastForward(200);
    const assemblyFactor = await scale('.assembly-flow-region') / assemblyScale;
    await page.getByRole('button', { name: 'Логика', exact: true }).click();
    await page.locator('.logic-canvas').waitFor();
    const logicArea = await page.locator('.reactflow-region').boundingBox();
    await page.mouse.move(logicArea.x + logicArea.width / 2, logicArea.y + 20);
    const logicScale = await scale('.reactflow-region');
    await page.mouse.wheel(0, 40); await page.evaluate(() => new Promise(requestAnimationFrame)); await page.clock.fastForward(200);
    const logicFactor = await scale('.reactflow-region') / logicScale;
    assert.ok(Math.abs(assemblyFactor - logicFactor) < 0.00001, 'The same wheel movement has the same zoom factor in both modes');
    await page.getByRole('button', { name: 'Монтаж', exact: true }).click();
    await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
    await page.getByRole('button', { name: 'Показать весь монтаж', exact: true }).click();
    await page.clock.fastForward(100);
    await page.screenshot({ path: '.artifacts/assembly-react-flow.png' });
    assert.equal(await fs.readFile('tests/fixtures/blink-mount-v2.clex.json', 'utf8'), source);
    assert.deepEqual(errors, []);
    console.log('PASS: real React Flow nodes/edges, physical handle geometry, forward/reverse native wire drags, invalid power/component links rejected, round-handle clicks, wire deletion, format compatibility, same wheel factor, source untouched.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
