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
export const getAsset = name => assets[`./assets/${name}`];
