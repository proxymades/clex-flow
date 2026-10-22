import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyHistory } from '../src/assembly/history.js';
import { addHardware, connectTerminal, disconnectTerminal, removeHardware, removeWire, selectBoard, transformAssembly } from '../src/assembly/model.js';
import { createProject, serializeProject } from '../src/projects/model.js';
import { addNode, withLogic } from '../src/logic/model.js';
import { catalog, led, timer, devkit, eth } from './catalog-fixture.js';
import { displayProject, displayModule } from './display-fixture.js';

function fixture() {
  let project = addHardware({ ...createProject('История'), boardSettings: { camera: 'disconnected' } }, led, catalog);
  const id = project.components[0].id;
  project = connectTerminal(project, catalog, id, 'anode', eth.pins.find(pin => pin.gpio === 17).id);
  return connectTerminal(project, catalog, id, 'cathode', 'P28');
}

test('удаление компонента отменяется вместе с проводами, GPIO и сторонами контактов', () => {
  let project = fixture();
  const id = project.components[0].id;
  project.assembly.portSides = { [id]: { anode: 'left' } };
  const original = structuredClone(project), history = createAssemblyHistory(project, catalog);
  project = history.change(project, current => removeHardware(current, catalog, id));
  assert.equal(project.components.length, 0);
  assert.equal(project.gpioAssignments.length, 0);
  project = history.undo(project);
  assert.deepEqual(project, original);
  serializeProject(project);
  project = history.redo(project);
  assert.equal(project.assembly.connections.length, 0);
  assert.equal(project.assembly.positions[id], undefined);
  assert.equal(project.moduleVersions[led.id], undefined);
  serializeProject(project);
});

test('связи, переподключение и отключение отменяются по одному действию', () => {
  let project = fixture();
  const id = project.components[0].id, original = structuredClone(project), history = createAssemblyHistory(project, catalog);
  project = history.change(project, current => disconnectTerminal(current, catalog, id, 'cathode'));
  project = history.change(project, current => connectTerminal(current, catalog, id, 'anode', eth.pins.find(pin => pin.gpio === 18).id));
  assert.equal(project.gpioAssignments[0].gpio, 18);
  project = history.undo(project);
  assert.equal(project.gpioAssignments[0].gpio, 17);
  project = history.undo(project);
  assert.deepEqual(project, original);
  project = history.change(project, current => removeWire(current, catalog, current.assembly.connections[0].id));
  assert.equal(project.gpioAssignments.length, 0);
  assert.deepEqual(history.undo(project), original);
});

test('положение и ручной маршрут возвращаются вместе, камера не расходует Undo/Redo', () => {
  let project = fixture();
  project.assembly.connections[0].route = [{ x: 840, y: 180 }, { x: 840, y: 320 }];
  const original = structuredClone(project), id = project.components[0].id, history = createAssemblyHistory(project, catalog);
  project = history.change(project, current => transformAssembly(current, catalog, { positions: { [id]: { x: 1200, y: 450 } } }));
  const moved = structuredClone(project.assembly);
  project = history.change(project, current => transformAssembly(current, catalog, { viewport: { x: 123, y: 234, zoom: 0.7 } }));
  project = history.undo(project);
  assert.deepEqual(project.assembly.positions, original.assembly.positions);
  assert.deepEqual(project.assembly.connections, original.assembly.connections);
  assert.equal(project.assembly.viewport.x, 123);
  assert.equal(history.canUndo, false);
  project = history.change(project, current => transformAssembly(current, catalog, { viewport: { x: 80, y: 90, zoom: 1.2 } }));
  assert.equal(history.canRedo, true);
  project = history.redo(project);
  assert.deepEqual(project.assembly.positions, moved.positions);
  assert.deepEqual(project.assembly.connections, moved.connections);
  assert.equal(project.assembly.viewport.zoom, 1.2);
  const before = structuredClone(project.assembly.connections);
  project = history.change(project, current => ({ ...current, assembly: { ...current.assembly, connections: current.assembly.connections.map(wire => { const next = { ...wire }; delete next.route; return next; }) } }));
  project = history.undo(project);
  assert.deepEqual(project.assembly.connections, before);
});

test('отмена монтажа сохраняет последующие правки логики, метаданные и версии модулей', () => {
  let project = fixture();
  const history = createAssemblyHistory(project, catalog), id = project.components[0].id;
  project = history.change(project, current => removeHardware(current, catalog, id));
  project = withLogic(project, addNode(project.logic, timer, project.components, project, catalog));
  project = { ...project, name: 'Новое имя', updatedAt: '2026-10-22T00:00:00Z' };
  const graph = structuredClone(project.logic);
  assert.equal(history.sync(project), false);
  project = history.undo(project);
  assert.deepEqual(project.logic, graph);
  assert.equal(project.name, 'Новое имя');
  assert.equal(project.updatedAt, '2026-10-22T00:00:00Z');
  assert.equal(project.moduleVersions[timer.id], timer.version);
  assert.equal(project.moduleVersions[led.id], led.version);
  project = history.redo(project);
  assert.equal(project.moduleVersions[timer.id], timer.version);
  assert.equal(project.moduleVersions[led.id], undefined);
  serializeProject(project);
});

test('удаленный дисплей возвращает экран, не затирая другие экраны и граф', () => {
  let project = displayProject();
  project = addHardware(project, displayModule, catalog);
  const [display, other] = project.components;
  project.screens[other.id] = structuredClone(project.screens[display.id]);
  const history = createAssemblyHistory(project, catalog), original = structuredClone(project.screens[display.id]);
  project = history.change(project, current => removeHardware(current, catalog, display.id));
  project = { ...project, screens: { ...project.screens, [other.id]: { ...project.screens[other.id], background: '#ffffff' } } };
  const graph = project.logic;
  project = history.undo(project);
  assert.deepEqual(project.screens[display.id], original);
  assert.equal(project.screens[other.id].background, '#ffffff');
  assert.deepEqual(project.logic, graph);
  project.screens[display.id] = { ...project.screens[display.id], background: '#aabbcc' };
  project = history.redo(project);
  assert.equal(project.screens[display.id], undefined);
  project = history.undo(project);
  assert.equal(project.screens[display.id].background, '#aabbcc');
  serializeProject(project);
});

test('отмена добавления дисплея убирает новый экран, повтор возвращает его актуальную версию', () => {
  let project = createProject('Дисплей');
  const history = createAssemblyHistory(project, catalog);
  project = history.change(project, current => addHardware(current, displayModule, catalog));
  const id = project.components[0].id;
  project = { ...project, screens: { [id]: { formatVersion: 1, background: '#123456', elements: [] } } };
  project = history.undo(project);
  assert.equal(project.components.length, 0);
  assert.equal(project.screens[id], undefined);
  serializeProject(project);
  project = history.redo(project);
  assert.equal(project.screens[id].background, '#123456');
  serializeProject(project);
});

test('ввод свойств объединяется, новое действие сбрасывает Redo, смена платы отменяется', () => {
  let project = fixture();
  const original = structuredClone(project), history = createAssemblyHistory(project, catalog);
  for (const name of ['Л', 'Лампа']) project = history.change(project, current => ({ ...current, components: current.components.map(component => ({ ...component, name })) }), { group: 'name' });
  project = history.undo(project);
  assert.deepEqual(project, original);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  project = history.change(project, current => selectBoard(current, devkit));
  assert.equal(history.canRedo, false);
  assert.equal(project.boardId, devkit.id);
  project = history.undo(project);
  assert.deepEqual(project, original);
});

test('ошибочные и пустые действия не расходуют историю, внешняя замена сбрасывает ее', () => {
  let project = fixture();
  const history = createAssemblyHistory(project, catalog);
  assert.throws(() => history.change(project, () => { throw new Error('Неверное подключение'); }));
  assert.equal(history.canUndo, false);
  project = history.change(project, current => current);
  assert.equal(history.canUndo, false);
  project = history.change(project, current => addHardware(current, led, catalog));
  const external = { ...project, boardSettings: { camera: 'connected' } };
  assert.equal(history.matches(external), false);
  assert.equal(history.sync(external), true);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});
