import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalLayout } from '../src/assembly/terminalLayout.js';
import { removeHardware } from '../src/assembly/model.js';
import { validateProject, parseProject, serializeProject } from '../src/projects/model.js';
import { generateFirmware } from '../src/firmware/generator.js';
import { firmwareProject } from './firmware-fixture.js';
import { catalog, led } from './catalog-fixture.js';

test('default contact layout preserves old module coordinates and dimensions', () => {
  const layout = terminalLayout(led);
  assert.equal(layout.width, led.visual.width); assert.equal(layout.height, led.visual.height);
  for (const terminal of led.terminals) { const actual = layout.terminals.find(item => item.id === terminal.id); assert.equal(actual.x, terminal.x); assert.equal(actual.y, terminal.y); }
});
test('physical contact sides persist without changing wire IDs, GPIO or firmware', () => {
  const project = firmwareProject(), componentId = project.components[0].id;
  const changed = { ...project, assembly: { ...project.assembly, portSides: { [componentId]: { anode: 'right', cathode: 'bottom' } } } };
  validateProject(changed);
  assert.deepEqual(parseProject(serializeProject(changed)).assembly.portSides, changed.assembly.portSides);
  assert.deepEqual(changed.assembly.connections, project.assembly.connections);
  assert.deepEqual(changed.gpioAssignments, project.gpioAssignments);
  assert.equal(generateFirmware(changed, catalog).mainC, generateFirmware(project, catalog).mainC);
  const layout = terminalLayout(led, changed.assembly.portSides[componentId]);
  assert.equal(layout.terminals[0].x, layout.width);
  assert.equal(layout.terminals[1].y, layout.height);
  assert.throws(() => validateProject({ ...changed, assembly: { ...changed.assembly, portSides: { [componentId]: { anode: 'inside' } } } }), /стороны контактов/);
  assert.deepEqual(removeHardware(changed, catalog, componentId).assembly.portSides, {});
});
