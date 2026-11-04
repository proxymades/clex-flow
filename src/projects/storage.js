import { invoke, isTauri } from '@tauri-apps/api/core';
import { serializeProject, MAX_PROJECT_BYTES } from './model.js';

import {catalog} from '../catalog/index.js';
import {PROJECT_KEY, browserRecords, backupBrowserProject, saveBrowserProject} from './browserStorage.js';
import {loadProjectFiles, readImportedProject} from './projectFiles.js';

export const desktop = isTauri();

export async function listProjects() {
  const files = desktop ? await invoke('list_projects') : Object.entries(browserRecords()).map(([id, contents]) => ({ id, contents }));
  return loadProjectFiles(files,catalog,(id,original,contents) => desktop
    ? invoke('upgrade_project',{id,original,contents})
    : saveBrowserProject(id,contents,original));
}

export async function saveProject(project) {
  const contents = serializeProject(project);
  if (desktop) return invoke('save_project', { id: project.id, contents });
  return saveBrowserProject(project.id,contents);
}

export async function deleteProject(id) {
  if (desktop) return invoke('delete_project', { id });
  const records = browserRecords();
  delete records[id];
  localStorage.setItem(PROJECT_KEY, JSON.stringify(records));
}

export async function importProject() {
  if (desktop) {
    const contents = await invoke('import_project');
    return contents === null ? null : readImportedProject(contents,catalog,contents => invoke('backup_project',{contents}));
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      try {
        if (file.size > MAX_PROJECT_BYTES) throw new Error('Размер проекта превышает 2 МБ.');
        resolve(await readImportedProject(await file.text(),catalog,backupBrowserProject));
      } catch (error) { reject(error); }
    }, { once: true });
    input.click();
  });
}

export async function exportProject(project) {
  const contents = serializeProject(project);
  if (desktop) return invoke('export_project', { contents });
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.clex.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function storagePath() {
  return desktop ? invoke('storage_path') : 'localStorage этого браузера (предпросмотр)';
}

export async function changeProjectDirectory() {
  if (!desktop) throw new Error('Выбор папки доступен в десктопном приложении.');
  return invoke('change_project_directory');
}
