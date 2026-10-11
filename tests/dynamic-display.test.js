import { addHardware, connectTerminal, connectionProblem as mountConnectionProblem } from '../src/assembly/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dynamicDisplayProject } from './dynamic-display-fixture.js';
import { catalog, timer, serial, read, button, eth } from './catalog-fixture.js';
import { screenPorts, screenIssues, saveScreen, elementPreviewText, elementUpdatePort } from '../src/displays/model.js';
import { validateGraph, connectionProblem, connectNodes, addNode, withLogic } from '../src/logic/model.js';
import { createProject, serializeProject, parseProject } from '../src/projects/model.js';
import { generateFirmware, firmwareFingerprint, cString } from '../src/firmware/generator.js';
const elements = project => project.screens[project.components[0].id].elements;
const view = project => project.logic.nodes.find(node => node.moduleId === 'clex.logic.display');

test('timer-counter-screen uses ordinary event and numeric edges and stable element IDs', () => {
  const project = dynamicDisplayProject(), dynamic = elements(project)[1];
  assert.deepEqual(validateGraph(project, catalog).filter(issue => issue.severity === 'error'), []);
  assert.equal(project.logic.nodes.length, 3);
  assert.deepEqual(new Set(project.logic.edges.map(edge => edge.dataType)), new Set(['event', 'number']));
  assert.equal(project.logic.edges.find(edge => edge.dataType === 'number').targetHandle, dynamic.id);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  assert.equal(elementPreviewText(dynamic), 'Счётчик: 0');
  assert.deepEqual(screenPorts(project.screens[project.components[0].id]).map(port => port.type), ['event', 'number', 'event']);
});
test('dynamic data requires the existing ready event and rejects a wrong value type', () => {
  const project = dynamicDisplayProject(), dynamic = elements(project)[1];
  const incomplete = structuredClone(project); incomplete.logic.edges = incomplete.logic.edges.filter(edge => edge.targetHandle !== 'trigger');
  assert.ok(validateGraph(incomplete, catalog).some(issue => issue.code === 'logic-order'));
  assert.throws(() => generateFirmware(incomplete, catalog), /Событ|Готово|Обновить/);
  assert.match(connectionProblem(project.logic, catalog, { source: project.logic.nodes.find(node => node.moduleId === timer.id).id, sourceHandle: 'tick', target: view(project).id, targetHandle: dynamic.id }, null, project), /Несовместимые типы/);
});
test('editing formatting preserves bindings; changing the type or deleting a dynamic element cleans its links', () => {
  const project = dynamicDisplayProject(), id = project.components[0].id;
  const screen = structuredClone(project.screens[id]); screen.elements[1].name = 'Показание'; screen.elements[1].prefix = 'Температура: '; screen.elements[1].suffix = ' °C'; screen.elements[1].initialValue = 25;
  const edited = saveScreen(project, id, screen);
  assert.deepEqual(edited.logic.edges, project.logic.edges); assert.equal(elementPreviewText(screen.elements[1]), 'Температура: 25 °C');
  assert.equal(screenIssues(screen, catalog.modules.find(module => module.display).display).length, 0);
  screen.elements[1].valueType = 'text'; screen.elements[1].initialValue = '25';
  const changed = saveScreen(edited, id, screen);
  assert.equal(changed.logic.edges.length, 2); assert.ok(!changed.logic.edges.some(edge => edge.targetHandle === screen.elements[1].id));
  screen.elements.pop(); const removed = saveScreen(project, id, screen);
  assert.equal(removed.logic.edges.length, 1); assert.equal(elements(removed)[0].text, elements(project)[0].text);
  assert.deepEqual(removed.assembly, project.assembly);
});
test('firmware updates just the bound LVGL object in the worker and retains static Cyrillic labels', () => {
  const project = dynamicDisplayProject(true), bundle = generateFirmware(project, catalog), dynamic = elements(project)[1];
  assert.match(bundle.mainC, /lv_label_set_text_fmt\(clex_text_elements\[i\]\.object, "%s%s%s", prefix, value, suffix\)/);
  assert.ok(bundle.mainC.includes(`clex_graphics_set_text(${cString(project.components[0].id)}, ${cString(dynamic.id)}, number)`));
  assert.ok(bundle.mainC.includes(cString('Счётчик: ')));
  assert.ok(bundle.mainC.includes(cString('Привет, мир! CLEX Flow')));
  const callback = bundle.mainC.split('static void __attribute__((unused)) timer_callback')[1].split('static void flow_worker')[0];
  assert.doesNotMatch(callback, /lv_|clex_graphics_set_text/);
  assert.match(callback, /xQueueSend/);
  const worker = bundle.mainC.split('static void flow_worker')[1].split('void app_main')[0];
  assert.match(worker, /node_\d+\(\)/); assert.match(worker, /lv_timer_handler/);
  assert.doesNotMatch(bundle.mainC, /lv_obj_clean|lv_screen_load/);
  assert.match(bundle.mainC, /next > INT32_MAX.*next < INT32_MIN/);
  assert.match(bundle.mainC, /static void node_\d+_reset/);
});
test('boolean and UTF-8 text use the same screen ports and firmware update mechanism', () => {
  let project = dynamicDisplayProject();
  const id = project.components[0].id, dynamic = elements(project)[1];
  dynamic.valueType = 'text'; dynamic.initialValue = 'готов'; dynamic.prefix = 'Состояние: ';
  project.logic.edges = project.logic.edges.filter(edge => edge.target !== view(project).id);
  let graph = addNode(project.logic, serial); const source = graph.nodes.at(-1); source.parameters.message = 'Привет, мир!';
  graph = connectNodes(graph, catalog, { source: graph.nodes.find(node => node.moduleId === timer.id).id, sourceHandle: 'tick', target: source.id, targetHandle: 'trigger' }, project);
  graph = connectNodes(graph, catalog, { source: source.id, sourceHandle: 'done', target: view(project).id, targetHandle: 'trigger' }, project);
  graph = connectNodes(graph, catalog, { source: source.id, sourceHandle: 'text', target: view(project).id, targetHandle: dynamic.id }, project);
  project = withLogic(project, graph);
  assert.deepEqual(validateGraph(project, catalog).filter(issue => issue.severity === 'error'), []);
  assert.match(generateFirmware(project, catalog).mainC, /clex_graphics_set_text\("[^" ]+", "[^" ]+", text_\d+\)/);
  source.parameters.message = '🌍'; assert.throws(() => generateFirmware(project, catalog), /шрифт/);
  dynamic.valueType = 'boolean'; dynamic.initialValue = false;
  assert.equal(elementPreviewText(dynamic), 'Состояние: Нет');
  assert.equal(screenPorts(project.screens[id])[1].type, 'boolean');
});
test('invalid dynamic metadata and unsupported prefix glyphs are rejected', () => {
  const project = dynamicDisplayProject(), screen = project.screens[project.components[0].id];
  screen.elements[1].valueType = 'object'; assert.throws(() => serializeProject(project), /динамического/);
  screen.elements[1].valueType = 'number'; screen.elements[1].prefix = '🌍'; assert.throws(() => generateFirmware(project, catalog), /шрифт/);
});
test('moving nodes preserves the build; changing a binding or formatting changes its fingerprint', async () => {
  const project = dynamicDisplayProject(), bundle = generateFirmware(project, catalog);
  const moved = structuredClone(project); moved.logic.nodes.reverse(); moved.logic.edges.reverse();
  moved.logic.nodes.forEach(node => { node.position = { x: 450, y: 300 }; });
  assert.equal(await firmwareFingerprint(generateFirmware(moved, catalog)), await firmwareFingerprint(bundle));
  elements(moved)[1].suffix = ' шт.';
  assert.notEqual(await firmwareFingerprint(generateFirmware(moved, catalog)), await firmwareFingerprint(bundle));
});

test('boolean output binds to a dynamic label through GPIO read events without numeric coercion', () => {
  let project = dynamicDisplayProject();
  const dynamic = elements(project)[1]; dynamic.valueType = 'boolean'; dynamic.initialValue = false;
  project.logic.edges = project.logic.edges.filter(edge => edge.target !== view(project).id);
  project = addHardware(project, button);
  const component = project.components.at(-1);
  const pin = eth.pins.find(pin => !mountConnectionProblem(project, catalog, component.id, 'signal', pin.id));
  assert.ok(pin, 'Select a documented free input pin from the board profile');
  project = connectTerminal(project, catalog, component.id, 'signal', pin.id);
  project = connectTerminal(project, catalog, component.id, 'ground', 'P28');
  let graph = addNode(project.logic, read, project.components);
  const source = graph.nodes.at(-1); source.parameters.componentId = component.id;
  const clock = graph.nodes.find(node => node.moduleId === timer.id);
  for (const connection of [
    { source: clock.id, sourceHandle: 'tick', target: source.id, targetHandle: 'trigger' },
    { source: source.id, sourceHandle: 'done', target: view(project).id, targetHandle: 'trigger' },
    { source: source.id, sourceHandle: 'level', target: view(project).id, targetHandle: dynamic.id },
  ]) graph = connectNodes(graph, catalog, connection, project);
  project = withLogic(project, graph);
  assert.deepEqual(validateGraph(project, catalog).filter(issue => issue.severity === 'error'), []);
  const sourceCode = generateFirmware(project, catalog).mainC;
  assert.ok(sourceCode.includes(`? ${cString('Да')} : ${cString('Нет')}`));
});

test('counter is a standalone number source for existing Serial blocks without a display', () => {
  let project = createProject('Счётчик без дисплея'), graph = project.logic;
  for (const module of [timer, catalog.modules.find(module => module.id === 'clex.logic.counter'), serial]) graph = addNode(graph, module);
  const [clock, counter, log] = graph.nodes;
  for (const connection of [
    { source: clock.id, sourceHandle: 'tick', target: counter.id, targetHandle: 'increment' },
    { source: counter.id, sourceHandle: 'done', target: log.id, targetHandle: 'trigger' },
    { source: counter.id, sourceHandle: 'value', target: log.id, targetHandle: 'number' },
  ]) graph = connectNodes(graph, catalog, connection);
  project = withLogic(project, graph);
  const bundle = generateFirmware(project, catalog);
  assert.equal(bundle.graphicsRuntime, null); assert.doesNotMatch(bundle.mainC, /lv_label|st7789/);
  assert.match(bundle.mainC, /static int32_t value_/); assert.match(bundle.mainC, /snprintf\(text_/);
});
test('new nodes do not overlap the extended display card', () => {
  const project = dynamicDisplayProject(); project.logic.nodes = [view(project)]; project.logic.edges = [];
  const graph = addNode(project.logic, catalog.modules.find(module => module.id === 'clex.logic.counter'), [], project, catalog);
  const [display, counter] = graph.nodes;
  assert.ok(counter.position.x >= display.position.x + 246 + 32 || counter.position.y >= display.position.y + 384 + 32);
});

test('two independent counters update two elements of one display through ordinary event ports', () => {
  let project = dynamicDisplayProject();
  const screen = project.screens[project.components[0].id];
  const first = screen.elements[1], second = { ...first, id: crypto.randomUUID(), name: 'Второй счётчик', prefix: 'Второй: ', y: 140 };
  screen.elements.push(second);
  let graph = project.logic;
  const counter1 = graph.nodes.find(node => node.moduleId === 'clex.logic.counter');
  graph.edges = graph.edges.map(edge => edge.targetHandle === 'trigger' ? { ...edge, targetHandle: elementUpdatePort(first.id) } : edge);
  graph = addNode(graph, timer); const timer2 = graph.nodes.at(-1); timer2.parameters.intervalMs = 2000;
  graph = addNode(graph, catalog.modules.find(module => module.id === 'clex.logic.counter')); const counter2 = graph.nodes.at(-1);
  for (const connection of [
    { source: timer2.id, sourceHandle: 'tick', target: counter2.id, targetHandle: 'increment' },
    { source: counter2.id, sourceHandle: 'done', target: view(project).id, targetHandle: elementUpdatePort(second.id) },
    { source: counter2.id, sourceHandle: 'value', target: view(project).id, targetHandle: second.id },
  ]) graph = connectNodes(graph, catalog, connection, project);
  project = withLogic(project, graph);
  assert.equal(project.logic.nodes.filter(node => node.moduleId === 'clex.logic.display').length, 1);
  assert.deepEqual(validateGraph(project, catalog).filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  assert.match(generateFirmware(project, catalog).mainC, /static void node_\d+_element_1\(void\)/);
  const wrong = structuredClone(project); wrong.logic.edges.find(edge => edge.source === counter1.id && edge.dataType === 'number').targetHandle = second.id;
  // Remove the other value edge to isolate readiness validation instead of duplicate-input validation.
  wrong.logic.edges = wrong.logic.edges.filter(edge => !(edge.source === counter2.id && edge.dataType === 'number'));
  assert.ok(validateGraph(wrong, catalog).some(issue => issue.code === 'logic-order'));
  const remaining = saveScreen(project, project.components[0].id, { ...screen, elements: screen.elements.filter(element => element.id !== second.id) });
  assert.ok(remaining.logic.edges.some(edge => edge.targetHandle === elementUpdatePort(first.id)));
  assert.deepEqual(validateGraph(remaining, catalog).filter(issue => issue.severity === 'error'), []);
});
