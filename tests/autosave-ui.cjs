/* global window, document */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLEX_BROWSER_EXECUTABLE || process.argv[2] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    window.__projectWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'clex-flow:projects:v1') window.__projectWrites++; return original.call(this, key, value); };
  });
  const writes = () => page.evaluate(() => window.__projectWrites);
  const stored = () => page.evaluate(() => JSON.parse(Object.values(JSON.parse(localStorage.getItem('clex-flow:projects:v1')))[0]));
  const settings = () => page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const experiment = () => page.getByRole('button', { name: 'Эксперимент', exact: true }).click();
  const toggle = () => page.getByRole('checkbox', { name: 'Автосохранение проектов', exact: true });
  const saved = () => page.getByText('Все изменения сохранены', { exact: true }).waitFor();
  try {
    await page.goto(process.env.CLEX_PREVIEW_URL || 'http://127.0.0.1:1420');
    await settings(); assert.equal(await toggle().isChecked(), true);
    await page.getByRole('button', { name: /Мои проекты/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Открыть JSON', exact: true }).click();
    await (await chooser).setFiles('tests/fixtures/blink-mount-v2.clex.json');
    await page.getByRole('textbox', { name: 'Описание', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Монтаж', exact: true }).click();
    await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
    await page.getByRole('button', { name: 'Обзор проекта', exact: true }).click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const initialWrites = await writes();
    await page.clock.fastForward(10_500);
    assert.equal(await writes(), initialWrites, 'Opening a migrated project must not rewrite it automatically');

    await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('First metadata edit');
    await page.clock.fastForward(9000); assert.equal(await writes(), initialWrites);
    await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Latest metadata edit');
    await page.clock.fastForward(9000); assert.equal(await writes(), initialWrites, 'Every edit starts a new ten-second delay');
    await page.clock.resume();
    await page.getByRole('button', { name: 'Монтаж', exact: true }).click();
    await page.locator('.assembly-flow-region[data-ready="true"]').waitFor();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1));
    await page.clock.fastForward(1001); await saved();
    assert.equal(await writes(), initialWrites + 1); assert.equal((await stored()).description, 'Latest metadata edit');

    await page.getByRole('button', { name: 'Компонент Внешний светодиод 1', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Резистор, Ом', exact: true }).fill('470');
    await page.clock.fastForward(10_001); await saved();
    assert.equal((await stored()).components[0].parameters.resistorOhms, 470, 'Assembly parameters use the same autosave');
    const component = page.getByRole('button', { name: 'Компонент Внешний светодиод 1', exact: true }), box = await component.boundingBox();
    const beforePosition = (await stored()).assembly.positions[(await stored()).components[0].id], beforeDragWrites = await writes();
    await page.mouse.move(box.x + 45, box.y + 20); await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y + 40, { steps: 8 });
    await page.clock.fastForward(10_500);
    assert.equal(await writes(), beforeDragWrites, 'Assembly drag pauses writes even while its model positions update');
    await page.mouse.up(); await page.clock.fastForward(10_001); await saved();
    assert.notDeepEqual((await stored()).assembly.positions[(await stored()).components[0].id], beforePosition);

    await page.getByRole('button', { name: 'Обзор проекта', exact: true }).click();
    await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Keep this draft in Settings');
    const beforeDisable = await writes(); await settings();
    assert.equal(await page.getByRole('dialog', { name: 'Сохранить изменения?', exact: true }).count(), 0);
    await toggle().uncheck();
    await experiment();
    assert.equal(await page.getByRole('textbox', { name: 'Описание', exact: true }).inputValue(), 'Keep this draft in Settings');
    await page.getByText('Ручное сохранение', { exact: true }).waitFor();
    await page.clock.fastForward(60_000); assert.equal(await writes(), beforeDisable, 'Disabling cancels the pending save');
    await page.keyboard.press('Meta+s'); await page.getByText('Проект сохранён', { exact: true }).waitFor();
    assert.equal((await stored()).description, 'Keep this draft in Settings');
    const manualWrites = await writes(); await page.clock.fastForward(60_000); assert.equal(await writes(), manualWrites, 'Manual save leaves no duplicate scheduled write');

    await page.reload(); await page.clock.fastForward(100);
    await settings(); assert.equal(await toggle().isChecked(), false, 'Preference survives reload');
    await page.getByRole('button', { name: /Мои проекты/ }).click(); await page.locator('.project-open').click();
    await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Discard this manual draft');
    await page.getByRole('button', { name: /Мои проекты/ }).click();
    await page.getByRole('dialog', { name: 'Сохранить изменения?', exact: true }).waitFor();
    await page.clock.fastForward(60_000);
    assert.equal((await stored()).description, 'Keep this draft in Settings');
    await page.getByRole('button', { name: 'Не сохранять', exact: true }).click(); await page.locator('.project-open').click();
    assert.equal(await page.getByRole('textbox', { name: 'Описание', exact: true }).inputValue(), 'Keep this draft in Settings');

    await page.getByRole('button', { name: 'Логика', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить блок: Таймер', exact: true }).click();
    const beforeEnable = await writes(); await page.clock.fastForward(60_000); assert.equal(await writes(), beforeEnable);
    await settings(); await toggle().check();
    await page.clock.fastForward(9000); assert.equal(await writes(), beforeEnable);
    await page.clock.fastForward(1001); assert.equal((await stored()).logic.nodes.length, 1, 'Enabling schedules the existing draft, including logic');
    await experiment(); await saved();
    await settings(); await page.setViewportSize({ width: 1000, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: ten-second debounce for metadata/assembly/logic, drag pause, tabs and Settings preserve drafts, pending cancellation, manual shortcut, persistent preference, discard protection, re-enable and small layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
