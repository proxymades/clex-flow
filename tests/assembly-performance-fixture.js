import { catalog } from './catalog-fixture.js';
import { displayProject } from './display-fixture.js';
import { addHardware, connectTerminal, connectionProblem } from '../src/assembly/model.js';
import { componentContact } from '../src/assembly/endpoints.js';
import { addNode, withLogic } from '../src/logic/model.js';

export function addStepper(project, index = 0, { allowUnconnected = false } = {}) {
  const board = catalog.boards.find(board => board.id === project.boardId);
  const driverModule = catalog.modules.find(module => module.id === 'clex.hardware.drv8825');
  project = addHardware(project, catalog.modules.find(module => module.id === 'clex.hardware.nema17'), catalog);
  const motor = project.components.at(-1);
  project = addHardware(project, driverModule, catalog);
  const driver = project.components.at(-1);
  project.assembly.positions = { ...project.assembly.positions,
    [driver.id]: { x: project.assembly.positions.board.x + board.width + 180, y: 80 + index * 420 },
    [motor.id]: { x: project.assembly.positions.board.x + board.width + 620, y: 80 + index * 420 },
  };
  for (const terminal of driverModule.terminals.filter(terminal => terminal.kind !== 'winding-output')) {
    const pin = board.pins.find(pin => !connectionProblem(project, catalog, driver.id, terminal.id, pin.id));
    if (!pin && allowUnconnected) continue;
    if (!pin) throw Error('No compatible pin for driver ' + index + ': ' + terminal.id);
    project = connectTerminal(project, catalog, driver.id, terminal.id, pin.id);
  }
  for (const id of ['a1', 'a2', 'b1', 'b2']) project = connectTerminal(project, catalog, motor.id, id, componentContact(driver.id, id));
  let graph = addNode(project.logic, catalog.modules.find(module => module.id === 'clex.logic.stepper'), project.components, project, catalog);
  graph = { ...graph, nodes: graph.nodes.map(node => node.id === graph.nodes.at(-1).id ? { ...node, parameters: { ...node.parameters, componentId: driver.id } } : node) };
  return { project: withLogic(project, graph), driver, motor };
}

export function assemblyPerformanceProject() {
  let project = displayProject();
  project.name = 'Монтаж: дисплей и три двигателя';
  project.assembly.positions[project.components[0].id] = { x: -300, y: 140 };
  for (let index = 0; index < 3; index++) project = addStepper(project, index, { allowUnconnected: true }).project;
  return project;
}
