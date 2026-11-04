import { openProject } from './upgrade.js';
import { serializeProject } from './model.js';

export async function loadProjectFiles(files, catalog, upgrade) {
  const projects = [], errors = [], notices = [];
  for (const file of files) {
    try {
      if (file.error) throw new Error(file.error);
      const {project,upgraded} = openProject(file.contents,catalog);
      if (project.id !== file.id) throw new Error('ID проекта не совпадает с именем файла.');
      projects.push(project);
      if (upgraded) {
        try {
          const backup = await upgrade(file.id,file.contents,serializeProject(project));
          notices.push(project.name + ': проект преобразован. Резервная копия: ' + backup);
        } catch (error) {
          notices.push(project.name + ': проект открыт, но новый формат не записан. Исходный файл сохранён. ' + String(error.message || error));
        }
      }
    } catch (error) { errors.push(file.id + ': ' + String(error.message || error)); }
  }
  return {projects,errors,notices};
}

export async function readImportedProject(contents, catalog, backup) {
  const result = openProject(contents,catalog);
  let notice = 'Локальная копия проекта открыта', conversionNotice;
  if (result.upgraded) {
    notice = 'Старый проект открыт. Исходный файл не изменён.';
    try { conversionNotice = result.project.name + ': резервная копия: ' + await backup(contents); }
    catch (error) { conversionNotice = result.project.name + ': импортированный файл не изменён. Резервная копия не создана: ' + String(error.message || error); }
  }
  return {project:result.project,notice,...(conversionNotice ? {conversionNotice} : {})};
}
