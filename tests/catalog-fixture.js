import { readFileSync, readdirSync } from 'node:fs';
const load = folder => readdirSync(new URL(`../src/catalog/${folder}/`, import.meta.url)).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(new URL(`../src/catalog/${folder}/${name}`, import.meta.url), 'utf8')));
export const catalog = { boards: load('boards'), modules: load('modules') };
export const eth = catalog.boards.find(board => board.id === 'waveshare-esp32-s3-eth');
export const devkit = catalog.boards.find(board => board.id === 'espressif-devkitc-1-v1-1-n8r8');
export const led = catalog.modules.find(module => module.id === 'clex.hardware.led');
export const button = catalog.modules.find(module => module.id === 'clex.hardware.button');

export const timer = catalog.modules.find(module => module.id === 'clex.logic.timer');
export const read = catalog.modules.find(module => module.id === 'clex.logic.gpio-read');
export const set = catalog.modules.find(module => module.id === 'clex.logic.gpio-set');
export const toggle = catalog.modules.find(module => module.id === 'clex.logic.gpio-toggle');
export const serial = catalog.modules.find(module => module.id === 'clex.logic.serial');
