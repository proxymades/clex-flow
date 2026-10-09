/* global window, requestAnimationFrame */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const { firmwareProject } = await import('./firmware-fixture.js');
  const { serializeProject } = await import('../src/projects/model.js');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLEX_BROWSER_EXECUTABLE || process.argv[2] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    window.__projectSerializations = 0; window.__writes = 0;
    const stringify = JSON.stringify, setItem = Storage.prototype.setItem;
    JSON.stringify = function(value, ...args) { if (value?.logic) window.__projectSerializations++; return stringify.call(this, value, ...args); };
    Storage.prototype.setItem = function(key, value) { if (key === 'clex-flow:projects:v1') window.__writes++; return setItem.call(this, key, value); };
  });
  const stored = () => page.evaluate(() => JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
  const counters = () => page.evaluate(() => ({ serializations: window.__projectSerializations, writes: window.__writes }));
  const save = async () => { await page.getByRole('button', { name: 'Сохранить', exact: true }).first().click(); await page.getByText('Проект сохранён', { exact: true }).waitFor(); };
  try {
    await page.goto(process.env.CLEX_PREVIEW_URL || 'http://127.0.0.1:1420');
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Открыть JSON', exact: true }).click();
    await (await chooser).setFiles({ name: 'canvas.clex.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(firmwareProject())) });
    await page.getByRole('button', { name: 'Монтаж', exact: true }).click();
    const component = page.getByRole('button', { name: 'Компонент Внешний светодиод 1', exact: true }), box = await component.boundingBox();
    const before = (await stored()).assembly.positions;
    await page.mouse.move(box.x + 45, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 55, box.y + 25);
    await page.evaluate(() => new Promise(requestAnimationFrame)); const start = await counters();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(box.x + 55 + i, box.y + 25 + i); await page.evaluate(() => new Promise(requestAnimationFrame)); }
    assert.deepEqual(await counters(), start, 'SVG drag also stays outside project serialization and storage');
    assert.equal(await page.locator('.breadcrumb .dirty-dot').count(), 0);
    await page.mouse.up(); await save();
    const moved = (await stored()).assembly.positions; assert.notDeepEqual(moved, before);

    // Space pans from the component body without moving the component.
    const panBox = await component.boundingBox(); await component.click();
    await page.keyboard.down('Space');
    await page.mouse.move(panBox.x + 45, panBox.y + 20); await page.mouse.down();
    await page.mouse.move(panBox.x + 80, panBox.y + 45, { steps: 10 }); await page.mouse.up(); await page.keyboard.up('Space'); await save();
    assert.deepEqual((await stored()).assembly.positions, moved);
    const svgBox = await page.locator('.assembly-svg').boundingBox(); await page.mouse.click(svgBox.x + 8, svgBox.y + 8);
    await page.keyboard.press('f'); await save();
    const assemblyZoom = (await stored()).assembly.viewport.zoom;
    await page.getByRole('button', { name: 'Увеличить монтаж', exact: true }).click(); await save();
    assert.ok(Math.abs((await stored()).assembly.viewport.zoom / assemblyZoom - 1.2) < 0.001);
    await page.getByRole('button', { name: 'Уменьшить монтаж', exact: true }).click(); await save();
    assert.ok(Math.abs((await stored()).assembly.viewport.zoom - assemblyZoom) < 0.001);

    await page.getByRole('button', { name: 'Логика', exact: true }).click();
    await page.locator('.react-flow__node').nth(2).waitFor();
    await page.getByRole('button', { name: 'Показать весь граф', exact: true }).click(); await save();
    const logicZoom = (await stored()).logic.viewport.zoom, originalLogicPositions = (await stored()).logic.nodes.map(node => node.position);
    await page.getByRole('button', { name: 'Увеличить граф', exact: true }).click(); await save();
    assert.ok(Math.abs((await stored()).logic.viewport.zoom / logicZoom - 1.2) < 0.001);
    await page.getByRole('button', { name: 'Уменьшить граф', exact: true }).click(); await save();

    const node = page.locator('.react-flow__node').filter({ has: page.getByText('Таймер 1', { exact: true }) });
    const body = await node.locator('.logic-node-summary').boundingBox();
    await page.mouse.move(body.x + 40, body.y + 20); await page.mouse.down();
    await page.mouse.move(body.x + 70, body.y + 40, { steps: 10 }); await page.mouse.up(); await save();
    assert.notDeepEqual((await stored()).logic.nodes[0].position, originalLogicPositions[0], 'Logic can be dragged by the card body');
    await page.getByRole('button', { name: 'Отменить изменение графа', exact: true }).click(); await save();
    assert.deepEqual((await stored()).logic.nodes.map(node => node.position), originalLogicPositions);
    await node.locator('header').click();
    const name = page.getByRole('textbox', { name: 'Название блока', exact: true });
    await name.click(); await page.keyboard.press('End'); await page.keyboard.type('f');
    assert.equal(await name.inputValue(), 'Таймер 1f', 'F stays ordinary text inside a field');
    await page.keyboard.press('Backspace');
    await node.locator('header').click(); const panNode = await node.locator('header').boundingBox();
    const oldViewport = (await stored()).logic.viewport;
    await page.keyboard.down('Space');
    await page.mouse.move(panNode.x + 40, panNode.y + 20); await page.mouse.down();
    await page.mouse.move(panNode.x + 70, panNode.y + 40, { steps: 10 }); await page.mouse.up(); await page.keyboard.up('Space'); await save();
    assert.deepEqual((await stored()).logic.nodes.map(node => node.position), originalLogicPositions);
    assert.notDeepEqual((await stored()).logic.viewport, oldViewport);
    const pane = await page.locator('.react-flow__pane').boundingBox(); await page.mouse.click(pane.x + 8, pane.y + 8); await page.keyboard.press('f'); await save();
    const region = await page.locator('.reactflow-region').boundingBox();
    for (const item of await page.locator('.react-flow__node').all()) { const rect = await item.boundingBox(); assert.ok(rect && rect.x >= region.x - 1 && rect.y >= region.y - 1 && rect.x + rect.width <= region.x + region.width + 1 && rect.y + rect.height <= region.y + region.height + 1, 'Fit restores all blocks to view'); }
    for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Монтаж', exact: true }).click(); await page.getByRole('button', { name: 'Логика', exact: true }).click(); await page.locator('.react-flow__node').nth(2).waitFor(); assert.equal(await page.locator('.react-flow__node').count(), 3); }
    await page.reload(); await page.locator('.project-open').click(); await page.getByRole('button', { name: 'Логика', exact: true }).click(); await page.locator('.react-flow__node').nth(2).waitFor(); assert.equal(await page.locator('.react-flow__edge').count(), 3);
    await page.setViewportSize({ width: 1000, height: 700 }); await page.getByRole('button', { name: 'Показать весь граф', exact: true }).click();
    await page.getByRole('button', { name: 'Увеличить граф', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: shared controls and 1.2 zoom step, local SVG drag, whole-card logic drag, Space pan in both modes, F fit, all blocks/edges survive tabs and reload, small layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
