import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateName, parseProject, serializeProject, sortedProjects } from '../src/projects/model.js';
import { addHardware, connectTerminal, selectBoard } from '../src/assembly/model.js';
import { catalog, led, devkit } from './catalog-fixture.js';

test('создание проекта и JSON round-trip сохраняют структуру', () => {
  const project = createProject('  Blink Test  ', 'Внешний светодиод');
  assert.equal(project.name, 'Blink Test');
  assert.equal(project.boardId, 'waveshare-esp32-s3-eth');
  assert.equal(project.formatVersion, 4);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  assert.notEqual(createProject('Другой').id, project.id);
});
test('пустое и слишком длинное название не принимаются', () => {
  for (const value of ['', '  ', 'x'.repeat(81), null]) assert.throws(() => validateName(value));
  assert.equal(validateName('Тест'), 'Тест');
});
test('повреждённые и будущие проекты не открываются', () => {
  assert.throws(() => parseProject('{broken'), /JSON/);
  for (const value of [null, [], {}, { ...createProject('Тест'), formatVersion: 5 }]) assert.throws(() => parseProject(JSON.stringify(value)));
});
test('неверные поля и небезопасный ID отклоняются', () => {
  for (const patch of [{ id: '../../test' }, { createdAt: 'yesterday' }, { boardId: '../../board' }, { description: 'x'.repeat(4001) }, { gpioAssignments: {} }, { moduleVersions: { timer: 5 } }, { logic: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0 } } }]) assert.throws(() => serializeProject({ ...createProject('Тест'), ...patch }));
});
test('логика из следующего этапа не теряется при открытии старой версией', () => {
  const project = createProject('Будущий'); project.logic.nodes.push({ id: 'timer', moduleId: 'timer' });
  assert.throws(() => parseProject(JSON.stringify(project)), /блок логики/);
  assert.equal(project.logic.nodes.length, 1);
});
test('неизвестные поля не удаляются при сохранении', () => {
  const project = { ...createProject('Тест'), customNotes: { color: 'purple' } };
  assert.deepEqual(parseProject(serializeProject(project)).customNotes, project.customNotes);
});
test('ограничение размера учитывает UTF-8 до парсинга', () => {
  assert.throws(() => parseProject('я'.repeat(1024 * 1024 + 1)), /2 МБ/);
});
test('последние проекты сортируются без изменения исходного массива', () => {
  const older = { ...createProject('Старый'), updatedAt: '2025-01-01T00:00:00Z' }, newer = { ...createProject('Новый'), updatedAt: '2026-01-01T00:00:00Z' };
  const source = [older, newer]; assert.deepEqual(sortedProjects(source), [newer, older]); assert.deepEqual(source, [older, newer]);
});
test('old project formats are rejected without changing the source', () => {
 for(const formatVersion of [1,2,3,5]){
  const project={...createProject('Old'),formatVersion},raw=JSON.stringify(project);
  assert.throws(()=>parseProject(raw),/Версия формата/);
  assert.equal(JSON.stringify(project),raw);
 }
});
test('полный монтаж, параметры и камера сохраняются через JSON round-trip', () => {
  let project = addHardware(selectBoard(createProject('LED'), devkit), led);
  const id = project.components[0].id;
  project = connectTerminal(project, catalog, id, 'anode', 'J1.4');
  project = connectTerminal(project, catalog, id, 'cathode', 'J1.22');
  project.assembly.viewport = { x: -150, y: 10, zoom: 1.2 };
  assert.deepEqual(parseProject(serializeProject(project)), project);
});
test('дублирующиеся ID, контакты, позиции и несовпадающие версии не принимаются', () => {
  const project = addHardware(createProject('LED'), led), component = project.components[0];
  const patches = [
    { components: [component, component] },
    { moduleVersions: { [led.id]: '2.0.0' } },
    { assembly: { ...project.assembly, positions: { board: { x: NaN, y: 0 } } } },
    { assembly: { ...project.assembly, connections: [{ id: 'w1', componentId: component.id, terminalId: 'anode', boardPinId: 'P34' }, { id: 'w2', componentId: component.id, terminalId: 'anode', boardPinId: 'P32' }] } },
    { assembly: { ...project.assembly, connections: [{ id: 'w1', componentId: 'missing', terminalId: 'anode', boardPinId: 'P34' }] } },
  ];
  for (const patch of patches) assert.throws(() => serializeProject({ ...project, ...patch }));
});
