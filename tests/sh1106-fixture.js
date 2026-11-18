import { addHardware, connectTerminal } from '../src/assembly/model.js';
import { addNode, withLogic } from '../src/logic/model.js';
import { createProject } from '../src/projects/model.js';
import { catalog } from './catalog-fixture.js';

export const oled = catalog.modules.find(module => module.id === 'clex.display.oled-sh1106');

export function sh1106Project(boardId = 'esp32-c3-super-mini', {address = '60', logic = true} = {}) {
  const board = catalog.boards.find(board => board.id === boardId);
  let project = addHardware(createProject('Проверка OLED SH1106', '', boardId, {camera:'disconnected'}), oled, catalog);
  const component = project.components[0];
  component.parameters.i2cAddress = address;
  const [scl, sda] = board.target === 'esp32c3' ? [5, 6] : [2, 1];
  for (const [terminal, pin] of [
    ['gnd', board.pins.find(pin => pin.kind === 'ground')],
    ['vcc', board.pins.find(pin => pin.kind === 'power' && pin.voltage === 3.3)],
    ['scl', board.pins.find(pin => pin.gpio === scl)],
    ['sda', board.pins.find(pin => pin.gpio === sda)],
  ]) {
    project = connectTerminal(project, catalog, component.id, terminal, pin.id);
  }
  if (!logic) return project;
  const editor = catalog.modules.find(module => module.editor === 'screen');
  project = withLogic(project, addNode(project.logic, editor, project.components, project, catalog));
  project.screens = {
    [component.id]: {
      formatVersion: 1,
      background: '#000000',
      elements: [
        {id:'title', type:'text', text:'CLEX Flow', x:8, y:5, fontId:'montserrat_20', color:'#ffffff'},
        {id:'model', type:'text', text:'OLED SH1106', x:8, y:36, fontId:'montserrat_14', color:'#ffffff'},
      ],
    },
  };
  return project;
}
