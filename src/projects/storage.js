import { invoke, isTauri } from '@tauri-apps/api/core';
import { parseProject, serializeProject, MAX_PROJECT_BYTES } from './model.js';

export const desktop = isTauri();
const KEY = 'clex-flow:projects:v1';

function browserRecords() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return {};
  let records;
  try { records = JSON.parse(raw); } catch { throw new Error('Хранилище предпросмотра повреждено. Данные сохранены без изменений.'); }
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('Некорректное хранилище предпросмотра.');
  return records;
}

export async function listProjects() {
  const files = desktop ? await invoke('list_projects') : Object.entries(browserRecords()).map(([id, contents]) => ({ id, contents }));
  const projects = [], errors = [];
  for (const file of files) {
    try {
      if (file.error) throw new Error(file.error);
      const project = parseProject(file.contents);
      if (project.id !== file.id) throw new Error('ID проекта не совпадает с именем файла.');
      projects.push(project);
    } catch (error) { errors.push(`${file.id}: ${error.message}`); }
  }
  return { projects, errors };
}

export async function saveProject(project) {
  const contents = serializeProject(project);
  if (desktop) return invoke('save_project', { id: project.id, contents });
  localStorage.setItem(KEY, JSON.stringify({ ...browserRecords(), [project.id]: contents }));
}

export async function deleteProject(id) {
  if (desktop) return invoke('delete_project', { id });
  const records = browserRecords();
  delete records[id];
  localStorage.setItem(KEY, JSON.stringify(records));
}

export async function importProject() {
  if (desktop) {
    const contents = await invoke('import_project');
    return contents === null ? null : parseProject(contents);
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
        resolve(parseProject(await file.text()));
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
