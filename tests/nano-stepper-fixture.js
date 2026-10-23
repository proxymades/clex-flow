import { catalog } from './catalog-fixture.js';
import { stepperProject } from './stepper-fixture.js';
import { addStepper } from './assembly-performance-fixture.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
export function nanoStepperProject({ drivers = ['drv8825'], speed = 400, serial = false, bootloader = 'standard' } = {}) {
 let { project } = stepperProject(drivers[0], 'arduino-nano-atmega328p-ch340');
 project.boardSettings.bootloader = bootloader;
 const timer = project.logic.nodes.find(node => node.moduleId === 'clex.logic.timer');
 for (let index = 1; index < drivers.length; index++) {
  project = addStepper(project, index).project;
  const driver = project.components.at(-1);
  if (drivers[index] !== 'drv8825') throw Error('Additional fixture drivers use DRV8825');
  const motion = project.logic.nodes.find(node => node.parameters.componentId === driver.id);
  project = withLogic(project, connectNodes(project.logic, catalog, { source: timer.id, sourceHandle: 'tick', target: motion.id, targetHandle: 'trigger' }, project));
 }
 project.logic.nodes.filter(node => node.moduleId === 'clex.logic.stepper').forEach(node => { node.parameters.speed = speed; });
 if (serial) {
  let graph = addNode(project.logic, catalog.modules.find(module => module.id === 'clex.logic.serial'), project.components, project, catalog);
  const output = graph.nodes.at(-1), motion = graph.nodes.find(node => node.moduleId === 'clex.logic.stepper');
  for (const [sourceHandle, targetHandle] of [['changed', 'trigger'], ['error', 'text'], ['position', 'number']]) graph = connectNodes(graph, catalog, { source: motion.id, sourceHandle, target: output.id, targetHandle }, { ...project, logic: graph });
  project = withLogic(project, graph);
 }
 return project;
}
