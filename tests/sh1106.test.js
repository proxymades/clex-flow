import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, timer, serial } from './catalog-fixture.js';
import { mountXgzp } from './xgzp-fixture.js';
import { oled, sh1106Project } from './sh1106-fixture.js';
import { addHardware, connectionProblem, validateAssembly } from '../src/assembly/model.js';
import { displayDescription } from '../src/displays/model.js';
import { monochromePixel } from '../src/displays/monochrome.js';
import { parseProject, serializeProject } from '../src/projects/model.js';
import { generateFirmware, firmwareFingerprint } from '../src/firmware/generator.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';

test('Super Mini OLED uses its four labelled contacts and generates SH1106 page transfers', () => {
  const project = sh1106Project();
  const board = catalog.boards.find(board => board.id === project.boardId);
  const component = project.components[0];
  assert.deepEqual(project.assembly.connections.map(({terminalId,boardPinId}) => [terminalId,boardPinId]),
    [['gnd','R2'],['vcc','R3'],['scl','L1'],['sda','L2']]);
  assert.match(connectionProblem(project, catalog, component.id, 'vcc', board.pins.find(pin=>pin.voltage===5).id), /напряжением/);
  assert.equal(project.logic.nodes[0].parameters.componentId, component.id);
  const firmware = generateFirmware(project, catalog);
  assert.deepEqual(firmware.featureRuntimes, ['sh1106-esp32c3']);
  assert.match(firmware.files['main/CMakeLists.txt'], /esp_driver_i2c/);
  assert.match(firmware.mainC, /\{0,6,5,NULL\}/);
  assert.match(firmware.mainC, /CLEX_SH1106_WIDTH = 128, CLEX_SH1106_PAGES = 8, CLEX_SH1106_OFFSET = 2/);
  assert.match(firmware.mainC, /\.device_address = 0x3C,/);
  assert.match(firmware.mainC, /LV_DISPLAY_RENDER_MODE_FULL/);
  assert.match(firmware.mainC, /CLEX Flow/);
  assert.doesNotMatch(firmware.mainC, /esp_lcd_panel_io_register_event_callbacks/);
  component.parameters.i2cAddress = '61';
  assert.match(generateFirmware(project,catalog).mainC, /\.device_address = 0x3D,/);
  component.parameters.i2cPort = '1';
  assert.ok(validateAssembly(project,catalog).some(issue=>issue.code==='i2c-config'));
});

test('an OLED and an XGZP sensor share the same I2C pins at different addresses', () => {
  const original = sh1106Project('waveshare-esp32-s3-eth');
  const { project } = mountXgzp(original, { port: '0' });
  assert.equal(project.assembly.connections.length, 8);
  assert.deepEqual(validateAssembly(project,catalog).filter(issue=>issue.severity==='error'), []);
  const firmware = generateFirmware(project,catalog);
  assert.equal(firmware.mainC.match(/\{0,1,2,NULL\}/g)?.length, 1);
  const duplicate = addHardware(project, oled, catalog);
  duplicate.components.at(-1).parameters.i2cPort = '0';
  assert.ok(validateAssembly(duplicate,catalog).some(issue=>issue.message.includes('0x3C уже занят')));
});

test('a mounted OLED does not inject a driver or a bus until a display block uses it', () => {
  let project = sh1106Project(undefined, {logic:false});
  for (const definition of [timer, serial]) {
    project = withLogic(project, addNode(project.logic, definition, project.components, project, catalog));
  }
  const [clock, message] = project.logic.nodes;
  project = withLogic(project, connectNodes(project.logic, catalog,
    {source:clock.id, sourceHandle:'tick', target:message.id, targetHandle:'trigger'}, project));
  const firmware = generateFirmware(project,catalog);
  assert.ok(!firmware.graphicsRuntime);
  assert.doesNotMatch(firmware.mainC, /clex_sh1106|clex_peripheral_buses_initialize/);
});

test('SH1106 legacy colors retain their pixel states and round-trip without changing firmware', async () => {
  let project = sh1106Project();
  const component = project.components[0];
  project.logic.nodes[0].moduleVersion = '1.2.0';
  project = withLogic(project, project.logic);
  const screen = project.screens[component.id];
  screen.elements[0].color = '#ffdd00';
  screen.elements[1].color = '#0000ff';
  assert.equal(monochromePixel(screen.elements[0].color), '#ffffff');
  assert.equal(monochromePixel(screen.elements[1].color), '#000000');
  assert.equal(monochromePixel('#7f7f7f'), '#000000');
  assert.equal(monochromePixel('#808080'), '#ffffff');

  const original = await firmwareFingerprint(generateFirmware(project, catalog));
  component.moduleVersion = '1.0.0';
  project.moduleVersions[component.moduleId] = '1.0.0';
  delete component.parameters.panelColor;
  assert.equal(displayDescription(component, catalog).previewGlow, '#55bfff');
  assert.deepEqual(validateAssembly(project,catalog).filter(issue=>issue.severity==='error'), []);

  component.parameters.panelColor = 'white';
  const reopened = parseProject(serializeProject(project));
  assert.equal(displayDescription(reopened.components[0],catalog).previewGlow, '#ffffff');
  assert.equal(reopened.components[0].moduleVersion, '1.0.0');
  assert.deepEqual(reopened.assembly, project.assembly);
  assert.equal(reopened.logic.nodes[0].moduleVersion, '1.2.0');
  assert.deepEqual(reopened.screens[component.id], screen);
  assert.equal(await firmwareFingerprint(generateFirmware(reopened, catalog)), original);
  reopened.components[0].parameters.panelColor = 'red';
  assert.ok(validateAssembly(reopened,catalog).some(issue=>issue.code==='parameter-option'));
  reopened.components[0].parameters.panelColor = 'blue';
  delete reopened.components[0].parameters.i2cAddress;
  assert.ok(validateAssembly(reopened,catalog).some(issue=>issue.code==='parameter-option'));
});
