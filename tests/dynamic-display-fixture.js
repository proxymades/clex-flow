import { displayProject } from './display-fixture.js';
import { catalog, timer, serial } from './catalog-fixture.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
export function dynamicDisplayProject(monitor = false) {
  let project = displayProject();
  const screen = project.screens[project.components[0].id];
  screen.background = '#071521';
  screen.elements[0].x = 8; screen.elements[0].y = 20; screen.elements[0].color = '#ffffff';
  screen.elements.push({ id: crypto.randomUUID(), name: 'Счётчик', type: 'text', mode: 'dynamic', valueType: 'number', initialValue: 0, prefix: 'Счётчик: ', suffix: '', text: '', x: 8, y: 90, fontId: 'montserrat_20', color: '#ffe08a' });
  let graph = addNode(project.logic, timer);
  const clock = graph.nodes.at(-1); clock.parameters.intervalMs = 1000;
  graph = addNode(graph, catalog.modules.find(module => module.id === 'clex.logic.counter'));
  const counter = graph.nodes.at(-1), view = graph.nodes[0];
  const connect = (source, sourceHandle, target, targetHandle) => { graph = connectNodes(graph, catalog, { source: source.id, sourceHandle, target: target.id, targetHandle }, { ...project, logic: graph }); };
  connect(clock, 'tick', counter, 'increment');
  connect(counter, 'done', view, 'trigger');
  connect(counter, 'value', view, screen.elements[1].id);
  if (monitor) {
    graph = addNode(graph, serial); const log = graph.nodes.at(-1); log.parameters.message = 'Счётчик:';
    connect(counter, 'done', log, 'trigger'); connect(counter, 'value', log, 'number');
  }
  return withLogic(project, graph);
}
