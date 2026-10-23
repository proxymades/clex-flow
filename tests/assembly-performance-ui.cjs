/* global window, document, DOMMatrixReadOnly */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
(async () => {
  const { assemblyPerformanceProject } = await import('./assembly-performance-fixture.js');
  const { catalog } = await import('./catalog-fixture.js');
  const { terminalLayout } = await import('../src/assembly/terminalLayout.js');
  const project = assemblyPerformanceProject(), driver = project.components.find(component => component.moduleId === 'clex.hardware.drv8825');
  const wireId = project.assembly.connections.find(wire => wire.componentId === driver.id && wire.terminalId === 'step').id;
  const module = catalog.modules.find(module => module.id === driver.moduleId);
  const terminal = terminalLayout(module).terminals.find(terminal => terminal.id === 'step');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLEX_BROWSER_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const wire = page.locator('.physical-wire[data-wire="' + wireId + '"]');
  const card = page.locator('.react-flow__node[data-id="' + driver.id + '"]');
  const stored = () => page.evaluate(() => JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
  const save = async () => {
    const button = page.getByRole('button', { name: 'Сохранить', exact: true });
    if (!(await button.isDisabled())) await button.click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Сохранить' && button.disabled));
    return stored();
  };
  try {
    await fs.mkdir('.artifacts/assembly-performance', { recursive: true });
    await page.addInitScript(p => {
      if (!localStorage.getItem('clex-flow:projects:v1')) localStorage.setItem('clex-flow:projects:v1', JSON.stringify({ [p.id]: JSON.stringify(p) }));
    }, project);
    await page.goto(process.env.CLEX_PREVIEW_URL || 'http://127.0.0.1:1434');
    await page.locator('.project-open').click();
    await page.getByRole('button', { name: 'Монтаж', exact: true }).click();
    await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
    assert.equal(await page.locator('.assembly-hardware-node').count(), 7);
    assert.equal(await page.locator('.physical-wire').count(), 36);
    assert.equal(await page.getByText(/Недостаточно аппаратных таймеров движения/).count(), 0);

    await wire.focus(); await page.keyboard.press('Enter');
    const bend = wire.locator('.wire-bend-control').first();
    await bend.waitFor();
    const vertical = await bend.evaluate(element => element.style.cursor === 'ns-resize');
    await bend.focus(); await page.keyboard.press(vertical ? 'ArrowDown' : 'ArrowRight');
    const before = await save();
    assert.ok(before.assembly.connections.find(wire => wire.id === wireId).route.length);
    const box = await card.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + 20 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 4, start.y + 2);
    await page.waitForTimeout(80);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    await page.evaluate(() => {
      window.__dragFrames = []; window.__dragActive = true;
      let previous = performance.now();
      const sample = now => { window.__dragFrames.push(now - previous); previous = now; if (window.__dragActive) window.requestAnimationFrame(sample); };
      window.requestAnimationFrame(sample);
    });
    for (const [dx, dy] of [[100, 50], [40, 90], [140, 60]]) {
      await page.mouse.move(start.x + dx, start.y + dy, { steps: 15 });
      const live = await card.evaluate(element => { const matrix = new DOMMatrixReadOnly(element.style.transform); return { x: matrix.m41, y: matrix.m42 }; });
      const points = JSON.parse(await wire.getAttribute('data-route-points'));
      const expected = [live.x + terminal.x, live.y + terminal.y];
      for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(points.at(-1)[axis] - expected[axis]) < .01, 'wire follows the contact within DOM matrix rounding precision');
    }
    const frames = await page.evaluate(() => { window.__dragActive = false; return window.__dragFrames; });
    const { profile } = await cdp.send('Profiler.stop');
    const routerNames = new Set(['routeAssemblyEdges', 'orthogonalWireRoute', 'shortRoute', 'searchRoute']);
    const heavy = profile.nodes.filter(node => routerNames.has(node.callFrame.functionName)).reduce((sum, node) => sum + (node.hitCount || 0), 0);
    assert.equal(heavy, 0, 'full obstacle search does not execute during drag');
    assert.deepEqual((await stored()).assembly.positions, before.assembly.positions, 'drag preview stays outside the saved project');
    await page.mouse.up();
    const moved = await save();
    assert.notDeepEqual(moved.assembly.positions[driver.id], before.assembly.positions[driver.id]);
    assert.deepEqual(moved.gpioAssignments, before.gpioAssignments);
    const afterPath = JSON.parse(await wire.getAttribute('data-route-points'));
    await page.getByRole('button', { name: 'Отменить изменение монтажа', exact: true }).click();
    const undone = await save();
    assert.deepEqual(undone.assembly.positions, before.assembly.positions);
    assert.deepEqual(undone.assembly.connections, before.assembly.connections);
    await page.getByRole('button', { name: 'Повторить изменение монтажа', exact: true }).click();
    const redone = await save();
    assert.deepEqual(redone.assembly.positions, moved.assembly.positions);
    assert.deepEqual(redone.assembly.connections, moved.assembly.connections);
    assert.deepEqual(JSON.parse(await wire.getAttribute('data-route-points')), afterPath);
    await page.getByRole('button', { name: 'Логика', exact: true }).click();
    await page.getByRole('button', { name: 'Монтаж', exact: true }).click();
    await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
    assert.deepEqual(JSON.parse(await wire.getAttribute('data-route-points')), afterPath);
    const sorted = frames.slice(1).sort((a, b) => a - b);
    const metrics = { nodes: 8, wires: 36, sampledFrames: sorted.length, frameMedianMs: sorted[Math.floor(sorted.length * .5)], frameP95Ms: sorted[Math.floor(sorted.length * .95)], fullRouterSamplesDuringDrag: heavy };
    await fs.writeFile('.artifacts/assembly-performance/browser.json', JSON.stringify(metrics, null, 2));
    await page.screenshot({ path: '.artifacts/assembly-performance/optimized.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: 36 wires, live anchors, no full routing during drag, one undo step, saved manual routes and GPIO unchanged.');
    console.log(metrics);
  } catch (error) {
    await page.screenshot({ path: '.artifacts/assembly-performance/failure.png' });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
