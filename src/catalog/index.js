const boardFiles = import.meta.glob('./boards/*.json', { eager: true, import: 'default' });
const moduleFiles = import.meta.glob('./modules/*.json', { eager: true, import: 'default' });
const controllerFiles = import.meta.glob('./controllers/*.json', { eager: true, import: 'default' });
const assets = import.meta.glob('./assets/*.svg', { eager: true, query: '?url', import: 'default' });

export const boards = Object.values(boardFiles).sort((a, b) => a.id.localeCompare(b.id));
export const modules = Object.values(moduleFiles).sort((a, b) => a.id.localeCompare(b.id));
export const hardwareModules = modules.filter(module => module.kind === 'hardware');
export const logicModules = modules.filter(module => module.kind === 'logic');
export const controllers = Object.values(controllerFiles);
export const catalog = { boards, modules, controllers };
export const getBoard = id => boards.find(board => board.id === id);
export const getModule = id => modules.find(module => module.id === id);
export const getAsset = name => assets[`./assets/${name}`];
