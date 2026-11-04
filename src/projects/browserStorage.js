export const PROJECT_KEY = 'clex-flow:projects:v1';
export const BACKUP_PREFIX = 'clex-flow:project-backup:';
export function browserRecords(storage = localStorage) {
  const raw = storage.getItem(PROJECT_KEY);
  if (!raw) return {};
  let records;
  try { records = JSON.parse(raw); } catch { throw new Error('Хранилище предпросмотра повреждено. Данные сохранены без изменений.'); }
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('Некорректное хранилище предпросмотра.');
  return records;
}
export async function backupBrowserProject(contents, storage = localStorage) {
  const bytes = new TextEncoder().encode(contents);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
  const key = BACKUP_PREFIX + hash;
  if (storage.getItem(key) === null) storage.setItem(key,contents);
  if (storage.getItem(key) !== contents) throw new Error('Не удалось проверить резервную копию. Исходный проект не заменён.');
  return key;
}
export async function saveBrowserProject(id, contents, expected, storage = localStorage) {
  const original = browserRecords(storage)[id];
  if (expected !== undefined && original !== expected && original !== contents) throw new Error('Исходный проект изменился. Откройте его заново; файл не заменён.');
  let backup;
  if (expected !== undefined) backup = await backupBrowserProject(expected,storage);
  if (original !== undefined && [1,2,3].includes(JSON.parse(original).formatVersion)) backup = await backupBrowserProject(original,storage);
  const records = browserRecords(storage);
  if (records[id] !== original && records[id] !== contents) throw new Error('Исходный проект изменился. Откройте его заново; файл не заменён.');
  storage.setItem(PROJECT_KEY,JSON.stringify({...records,[id]:contents}));
  return backup;
}
