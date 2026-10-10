import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalConnection, physicalEdges } from '../src/assembly/flow.js';
import { connectionProblem } from '../src/assembly/model.js';
import { parseProject, serializeProject } from '../src/projects/model.js';
import { firmwareProject } from './firmware-fixture.js';
import { catalog } from './catalog-fixture.js';

test('physical React Flow handles resolve board-to-component and reverse drags to the same domain connection', () => {
  const project = firmwareProject(), componentId = project.components[0].id;
  const expected = { componentId, terminalId: 'anode', pinId: 'P34' };
  assert.deepEqual(physicalConnection({ source: 'board', sourceHandle: 'P34', target: componentId, targetHandle: 'anode' }), expected);
  assert.deepEqual(physicalConnection({ source: componentId, sourceHandle: 'anode', target: 'board', targetHandle: 'P34' }), expected);
  assert.equal(connectionProblem(project, catalog, componentId, 'anode', 'P34'), null);
  assert.match(connectionProblem(project, catalog, componentId, 'anode', 'P36'), /питанию/);
});

test('physical connection adapter rejects board-to-board and component-to-component links', () => {
  assert.throws(() => physicalConnection({ source: 'board', target: 'board' }), /контакт платы/);
  assert.throws(() => physicalConnection({ source: 'component-a', target: 'component-b' }), /контакт платы/);
});

test('React Flow edge projection preserves physical IDs and never changes the stored project format', () => {
  const project = firmwareProject(), before = serializeProject(project);
  const edges = physicalEdges(project);
  assert.equal(edges.length, project.assembly.connections.length);
  for (let i = 0; i < edges.length; i++) {
    const wire = project.assembly.connections[i], edge = edges[i];
    assert.equal(edge.id, wire.id); assert.equal(edge.source, 'board');
    assert.equal(edge.sourceHandle, wire.boardPinId);
    assert.equal(edge.target, wire.componentId); assert.equal(edge.targetHandle, wire.terminalId);
  }
  assert.equal(serializeProject(project), before);
  const restored = parseProject(before);
  assert.equal(restored.formatVersion, 3);
  assert.deepEqual(restored.assembly, project.assembly);
  assert.deepEqual(restored.logic, project.logic);
  assert.equal('nodes' in restored.assembly, false);
});
