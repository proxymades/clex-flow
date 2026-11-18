import { catalog, timer } from './catalog-fixture.js';
import { addHardware, connectionProblem, connectTerminal } from '../src/assembly/model.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
import { createProject } from '../src/projects/model.js';

const definition = id => catalog.modules.find(module => module.id === id);
export const motorBoards = catalog.boards.filter(board => board.pins.length);

export function cameraMotorProject(boardId, { camera = boardId === 'esp32-cam', motor = true } = {}) {
  const board = catalog.boards.find(item => item.id === boardId);
  const settings = board.options?.camera ? { camera: 'disconnected' } : {};
  let project = createProject('Камера и двигатель', '', boardId, settings);
  if (camera) project = addHardware(project, definition('clex.hardware.camera-dvp'), catalog);
  if (motor) {
    const device = definition('clex.hardware.bts7960');
    project = addHardware(project, device, catalog);
    const component = project.components.at(-1);
    for (const terminal of device.terminals.filter(item => !item.externalConnection)) {
      const pin = board.pins.find(candidate => !connectionProblem(project, catalog, component.id, terminal.id, candidate.id));
      if (!pin) throw new Error(boardId + ': no compatible pin for ' + terminal.label);
      project = connectTerminal(project, catalog, component.id, terminal.id, pin.id);
    }
  }

  const add = module => {
    project = withLogic(project, addNode(project.logic, module, project.components, project, catalog));
    return project.logic.nodes.at(-1);
  };
  const connect = (source, sourceHandle, target, targetHandle) => {
    const graph = connectNodes(project.logic, catalog, {
      source: source.id, sourceHandle, target: target.id, targetHandle,
    }, project);
    project = withLogic(project, graph);
  };
  const clock = add(timer);
  clock.parameters.intervalMs = 75;
  if (camera) connect(clock, 'tick', add(definition('clex.logic.camera-capture')), 'trigger');
  if (motor) {
    const stopClock = add(timer);
    stopClock.parameters.intervalMs = 1500;
    const control = add(definition('clex.logic.dc-motor'));
    control.parameters.direction = 'reverse';
    connect(clock, 'tick', control, 'trigger');
    connect(stopClock, 'tick', control, 'stop');
    connect(control, 'done', add(definition('clex.logic.serial')), 'trigger');
    // The speed setting also accepts a number from another logic block.
    connect(clock, 'interval', control, 'speed');
  }
  return project;
}
