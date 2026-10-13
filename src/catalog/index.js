const boardFiles = import.meta.glob('./boards/*.json', { eager: true, import: 'default' });
const moduleFiles = import.meta.glob('./modules/*.json', { eager: true, import: 'default' });
const controllerFiles = import.meta.glob('./controllers/*.json', { eager: true, import: 'default' });
const assets = import.meta.glob('./assets/*.svg', { eager: true, query: '?url', import: 'default' });

const allBoards = Object.values(boardFiles).sort((a, b) => a.id.localeCompare(b.id));
export const boards = allBoards.filter(board => board.pins.length > 0);
export const modules = Object.values(moduleFiles).sort((a, b) => a.id.localeCompare(b.id));
export const hardwareModules = modules.filter(module => module.kind === 'hardware');
export const logicModules = modules.filter(module => module.kind === 'logic');
export const controllers = Object.values(controllerFiles);
export const catalog = { boards: allBoards, modules, controllers };
export const getBoard = id => allBoards.find(board => board.id === id);
export const getModule = id => modules.find(module => module.id === id);
// Vite's development SVG URLs stay unchanged during HMR; fingerprint the source
// so an already mounted <image> also reloads when its drawing or viewBox changes.
const svgSources = import.meta.env.DEV
  ? import.meta.glob('./assets/*.svg', { eager: true, query: '?raw', import: 'default' }) : {};
const developmentAssets = Object.fromEntries(Object.entries(svgSources).map(([key, source]) => {
  let fingerprint = 2166136261;
  for (let index = 0; index < source.length; index++) fingerprint = Math.imul(fingerprint ^ source.charCodeAt(index), 16777619);
  const url = assets[key];
  if (url.startsWith('data:')) return [key, url];
  return [key, url + (url.includes('?') ? '&' : '?') + 'drawing=' + (fingerprint >>> 0).toString(16)];
}));
export const getAsset = name => developmentAssets[`./assets/${name}`] || assets[`./assets/${name}`];
