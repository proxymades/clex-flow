/* global window, document */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const { createProject } = await import('../src/projects/model.js');
  const project = createProject('Проект на другом диске');
  const other = createProject('Проект из выбранной папки');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLEX_BROWSER_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ project, other }) => {
    window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__storageCalls = [];
    window.__directoryResult = 'cancel';
    window.__failSave = false;
    const source = 'C:\\Users\\Test\\AppData\\Roaming\\kz.clex.flow\\projects';
    const target = 'D:\\Мои проекты\\CLEX Flow';
    const initial = { path: source, files: { [source]: { [project.id]: JSON.stringify(project) }, [target]: { [other.id]: JSON.stringify(other) } } };
    if (!localStorage.getItem('fixture:storage')) localStorage.setItem('fixture:storage', JSON.stringify(initial));
    const state = () => JSON.parse(localStorage.getItem('fixture:storage'));
    const write = value => localStorage.setItem('fixture:storage', JSON.stringify(value));
    let next = 1;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => next++, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command.startsWith('plugin:event|')) return next++;
        if (command === 'list_projects') { const s = state(); return Object.entries(s.files[s.path]).map(([id, contents]) => ({ id, contents })); }
        if (command === 'storage_path') return state().path;
        if (command === 'save_project') {
          if (window.__failSave) throw 'Нет доступа для сохранения проекта';
          const s = state(); window.__storageCalls.push({ command, path: s.path, contents: args.contents });
          s.files[s.path][args.id] = args.contents; write(s); return null;
        }
        if (command === 'change_project_directory') {
          window.__storageCalls.push({ command });
          await new Promise(resolve => setTimeout(resolve, 100));
          if (window.__directoryResult === 'cancel') return null;
          if (window.__directoryResult === 'conflict') throw 'В выбранной папке уже есть другой файл. Файлы не заменены; выберите другую папку.';
          const s = state(); s.files[target] = { ...s.files[target], ...s.files[s.path] }; s.path = target; write(s); return target;
        }
        if (command === 'idf_ports') return [];
        if (command === 'idf_environment') throw 'SDK отсутствует в тесте';
        if (command === 'sdk_list') return { installations: [], active: {}, available: [], catalogError: '', managedPath: '/fixture/sdks', host: 'windows-x86_64', environment: null };
        throw new Error('Unexpected fixture RPC ' + command);
      },
    };
  }, { project, other });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('fixture:storage')));
  const choose = () => page.getByRole('button', { name: 'Выбрать папку', exact: true });
  const settings = () => page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const workspace = () => page.getByRole('button', { name: 'Текущий проект', exact: true }).click();
  try {
    const url = process.env.CLEX_PREVIEW_URL || 'http://127.0.0.1:1430';
    await page.goto(url); await settings();
    const original = await state();
    await choose().click(); await page.locator('.storage-actions button:not(:disabled)').waitFor();
    assert.deepEqual(await state(), original, 'Cancelling the native folder picker keeps the library unchanged');
    await page.getByRole('checkbox', { name: 'Автосохранение проектов', exact: true }).uncheck();
    await page.getByRole('button', { name: /Мои проекты/ }).click(); await page.locator('.project-open').click();
    await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Сохранить перед переносом');
    await settings(); await page.evaluate(() => { window.__directoryResult = 'conflict'; });
    await choose().click(); await page.getByRole('alert').filter({ hasText: 'другой файл' }).waitFor();
    assert.equal((await state()).path, original.path);
    assert.equal(JSON.parse((await state()).files[original.path][project.id]).description, 'Сохранить перед переносом');
    await page.getByRole('button', { name: 'Скрыть ошибку', exact: true }).click();
    await workspace(); await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Сохранение не удалось');
    await settings(); const beforeFailure = await page.evaluate(() => window.__storageCalls.filter(c => c.command === 'change_project_directory').length);
    await page.evaluate(() => { window.__failSave = true; }); await choose().click();
    await page.getByRole('alert').filter({ hasText: 'Нет доступа' }).waitFor();
    assert.equal(await page.evaluate(() => window.__storageCalls.filter(c => c.command === 'change_project_directory').length), beforeFailure, 'Failed draft save prevents migration');
    await page.getByRole('button', { name: 'Скрыть ошибку', exact: true }).click();
    await page.evaluate(() => { window.__failSave = false; window.__directoryResult = 'success'; });
    await choose().click(); await page.locator('.storage-path').filter({ hasText: 'D:' }).waitFor();
    const moved = await state(); assert.equal(Object.keys(moved.files[moved.path]).length, 2);
    assert.equal(JSON.parse(moved.files[moved.path][project.id]).description, 'Сохранение не удалось');
    assert.equal(moved.files[original.path][project.id], moved.files[moved.path][project.id]);
    const calls = await page.evaluate(() => window.__storageCalls);
    assert.equal(calls.at(-2).command, 'save_project'); assert.equal(calls.at(-1).command, 'change_project_directory');
    await page.screenshot({ path: '.artifacts/project-storage/settings-wide.png' });
    await workspace(); await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Запись на диск D');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.getByText('Проект сохранен', { exact: true }).waitFor();
    const updated = await state(); assert.equal(JSON.parse(updated.files[updated.path][project.id]).description, 'Запись на диск D');
    assert.equal(updated.files[original.path][project.id], moved.files[original.path][project.id], 'Later saves leave the backup untouched');
    await page.reload(); await settings(); await page.locator('.storage-path').filter({ hasText: 'D:' }).waitFor();
    await page.setViewportSize({ width: 1000, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: '.artifacts/project-storage/settings-small.png' });
    const web = await browser.newPage(); await web.goto(url); await web.getByRole('button', { name: 'Настройки', exact: true }).click();
    assert.equal(await web.getByRole('button', { name: 'Выбрать папку', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS storage UI: cancel, conflict, failed-save protection, save-before-switch, merged library, backup, new-path saves, restart persistence, small layout. Native RPC is simulated; filesystem migration is tested by Rust.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
