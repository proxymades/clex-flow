/* global window, requestAnimationFrame */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const { createProject, serializeProject } = await import('../src/projects/model.js');
  const { addNode, withLogic } = await import('../src/logic/model.js');
  const { timer } = await import('./catalog-fixture.js');
  let project = createProject('Drag regression');
  for (let i = 0; i < 100; i++) project = withLogic(project, addNode(project.logic, timer));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLEX_BROWSER_EXECUTABLE || process.argv[2] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    window.__graphClones = 0; window.__graphSerializations = 0; window.__writes = 0;
    const clone = window.structuredClone, stringify = JSON.stringify, setItem = Storage.prototype.setItem;
    window.structuredClone = function(value, ...args) { if (value?.nodes && value?.edges) window.__graphClones++; return clone.call(this, value, ...args); };
    JSON.stringify = function(value, ...args) { if (value?.logic || (value?.nodes && value?.edges)) window.__graphSerializations++; return stringify.call(this, value, ...args); };
    Storage.prototype.setItem = function(key, value) { if (key === 'clex-flow:projects:v1') window.__writes++; return setItem.call(this, key, value); };
  });
  const records = () => page.evaluate(() => JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
  const counters = () => page.evaluate(() => ({ clones: window.__graphClones, serializations: window.__graphSerializations, writes: window.__writes }));
  const saved = async () => { await page.clock.fastForward(10_100); await page.getByText('Все изменения сохранены', { exact: true }).waitFor(); };
  try {
    await page.goto(process.env.CLEX_PREVIEW_URL || 'http://127.0.0.1:1420');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Открыть JSON', exact: true }).click();
    await (await chooser).setFiles({ name: 'drag.clex.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(project)) });
    await page.getByRole('button', { name: 'Логика', exact: true }).click();
    await page.locator('.react-flow__node').nth(99).waitFor();
    assert.equal(await page.locator('.react-flow__node').count(), 100);
    const node = page.locator('.react-flow__node').filter({ has: page.getByText('Таймер 1', { exact: true }) });
    const box = await node.locator('header').boundingBox(), before = (await records()).logic.nodes[0].position;
    await page.mouse.move(box.x + 45, box.y + 20); await page.mouse.down();
    await page.mouse.move(box.x + 55, box.y + 25);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const start = await counters();
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(box.x + 55 + i * 2, box.y + 25 + i);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    assert.deepEqual(await counters(), start, '100-node drag must not clone/serialize the project or write files per frame');
    assert.equal(await page.locator('.breadcrumb .dirty-dot').count(), 0);
    await page.mouse.up(); await saved();
    assert.notDeepEqual((await records()).logic.nodes[0].position, before);
    await page.getByRole('button', { name: 'Отменить изменение графа', exact: true }).click(); await saved();
    assert.deepEqual((await records()).logic.nodes[0].position, before);

    // Multiple selected nodes must move and undo as one edit.
    await node.locator('header').click();
    const second = page.locator('.react-flow__node').filter({ has: page.getByText('Таймер 2', { exact: true }) });
    await second.locator('header').click({ modifiers: ['Meta'] });
    const beforeGroup = (await records()).logic.nodes.slice(0, 2).map(node => node.position), groupBox = await node.locator('header').boundingBox();
    await page.mouse.move(groupBox.x + 45, groupBox.y + 20); await page.mouse.down();
    await page.mouse.move(groupBox.x + 75, groupBox.y + 40, { steps: 10 }); await page.mouse.up(); await saved();
    const afterGroup = (await records()).logic.nodes.slice(0, 2).map(node => node.position);
    assert.notDeepEqual(afterGroup[0], beforeGroup[0]); assert.notDeepEqual(afterGroup[1], beforeGroup[1]);
    assert.ok(Math.abs((afterGroup[0].x - beforeGroup[0].x) - (afterGroup[1].x - beforeGroup[1].x)) < 0.001);
    await page.getByRole('button', { name: 'Отменить изменение графа', exact: true }).click(); await saved();
    assert.deepEqual((await records()).logic.nodes.slice(0, 2).map(node => node.position), beforeGroup);

    // A pending parameter save must stay paused throughout the next gesture.
    await node.locator('header').click();
    await page.getByRole('spinbutton', { name: 'Интервал, мс', exact: true }).fill('1250');
    const writes = (await counters()).writes, pendingBox = await node.locator('header').boundingBox();
    await page.mouse.move(pendingBox.x + 45, pendingBox.y + 20); await page.mouse.down();
    await page.mouse.move(pendingBox.x + 70, pendingBox.y + 40); await page.clock.fastForward(10_500);
    assert.equal((await counters()).writes, writes, 'Pre-existing autosave is paused while dragging');
    await page.mouse.up(); await saved();
    assert.equal((await records()).logic.nodes[0].parameters.intervalMs, 1250);

    // Camera movement also stays local until the gesture ends.
    const oldViewport = (await records()).logic.viewport, pane = await page.locator('.react-flow__pane').boundingBox();
    await page.mouse.move(pane.x + pane.width - 30, pane.y + pane.height - 30); await page.mouse.down();
    await page.mouse.move(pane.x + pane.width - 70, pane.y + pane.height - 60, { steps: 10 });
    await page.clock.fastForward(10_500); assert.deepEqual((await records()).logic.viewport, oldViewport);
    await page.mouse.up(); await saved(); assert.notDeepEqual((await records()).logic.viewport, oldViewport);
    assert.deepEqual(errors, []);
    console.log('PASS: 100-node drag has zero project clones/serializations/writes per frame; single/group undo, pending-save pause, final positions and camera persistence.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
