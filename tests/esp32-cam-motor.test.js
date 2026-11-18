import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from './catalog-fixture.js';
import { cameraMotorProject, motorBoards } from './esp32-cam-motor-fixture.js';
import { addHardware, connectionProblem, disconnectTerminal, gpioAssignments, moduleFor as mountedModule, validateAssembly } from '../src/assembly/model.js';
import { moduleSupportsBoard } from '../src/catalog/compatibility.js';
import { generateFirmware } from '../src/firmware/generator.js';
import { withLogic, validateGraph } from '../src/logic/model.js';
import { parseProject, serializeProject } from '../src/projects/model.js';

const moduleFor = id => catalog.modules.find(module => module.id === id);
const assertValid = project => {
  const issues = [...validateAssembly(project, catalog), ...validateGraph(project, catalog)];
  assert.deepEqual(issues.filter(issue => issue.severity === 'error'), []);
};

test('ESP32-CAM documents the sixteen contacts and adds the optional camera on its FPC connector', () => {
  const board = motorBoards.find(item => item.id === 'esp32-cam');
  assert.deepEqual(board.pins.filter(pin => pin.side === 'left').map(pin => pin.label),
    ['GPIO4', 'GPIO2', 'GPIO14', 'GPIO15', 'GPIO13', 'GPIO12', 'GND', '5V']);
  assert.deepEqual(board.pins.filter(pin => pin.side === 'right').map(pin => pin.label),
    ['GND', 'U0T / GPIO1', 'U0R / GPIO3', 'VCC', 'GND', 'GPIO0', 'GPIO16', '3V3']);
  const hardware = moduleFor('clex.hardware.camera-dvp');
  assert.deepEqual(motorBoards.filter(item => moduleSupportsBoard(hardware, item)).map(item => item.id), ['esp32-cam']);
  const combined = cameraMotorProject(board.id);
  assert.equal(combined.components[0].parameters.interfaceId, 'camera-fpc');
  assertValid(combined);
  assert.deepEqual(parseProject(serializeProject(combined)), combined);

  const bundle = generateFirmware(combined, catalog);
  assert.equal(bundle.consoleMode, 'uart');
  assert.deepEqual(bundle.featureRuntimes, ['camera-esp32-dvp', 'dc-motor-esp32']);
  assert.match(bundle.mainC, /\.ledc_timer = LEDC_TIMER_0,\s+\.ledc_channel = LEDC_CHANNEL_0/);
  assert.match(bundle.mainC, /\.gpio_num = \d+, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = 1,/);
  assert.match(bundle.mainC, /\.timer_sel = LEDC_TIMER_1/);
  assert.match(bundle.mainC, /esp_camera_fb_get\(\)[\s\S]+esp_camera_fb_return\(frame\)/);
  assert.match(bundle.files['sdkconfig.defaults'], /CONFIG_OV2640_SUPPORT=y\nCONFIG_OV3660_SUPPORT=y/);
  assert.match(bundle.files['sdkconfig.defaults'], /CONFIG_GC2145_SUPPORT=n/);
  assert.match(bundle.files['main/CMakeLists.txt'], /esp_psram/);
  assert.match(bundle.files['main/idf_component.yml'], /esp_jpeg: "=1\.3\.1"/);

  const duplicate = addHardware(combined, hardware, catalog);
  assert.ok(validateAssembly(duplicate, catalog).some(issue => issue.code === 'hardware-resource'));
  const withoutCamera = generateFirmware(cameraMotorProject(board.id, { camera: false }), catalog);
  assert.doesNotMatch(withoutCamera.mainC, /esp_camera/);
  assert.doesNotMatch(withoutCamera.files['sdkconfig.defaults'], /CONFIG_SPIRAM/);
});

test('BTS7960 generates stop and PWM on all selectable boards and reserves Nano Timer1 for stepper projects', () => {
  for (const board of motorBoards) {
    const project = cameraMotorProject(board.id, { camera: false });
    assertValid(project);
    const result = generateFirmware(project, catalog);
    assert.match(result.mainC, /clex_motor_0_set\(true, 75(?:[.]0|UL)?\);/);
    assert.match(result.mainC, /clex_motor_0_set\(false, 0\.0f\);/);
    assert.match(result.mainC, /_stop\(\);/);
    assert.match(result.mainC, board.platform === 'arduino-avr' ? /analogWrite\(/ : /ledc_update_duty\(/);
    assert.doesNotMatch(result.mainC, /ledc_set_duty_and_update/);
  }

  const board = motorBoards.find(item => item.platform === 'arduino-avr');
  const project = cameraMotorProject(board.id);
  const motor = project.components[0];
  const pin = number => board.pins.find(item => item.gpio === number).id;
  assert.match(connectionProblem(project, catalog, motor.id, 'rpwm', pin(8)), /аппаратный ШИМ/);
  assert.equal(connectionProblem(project, catalog, motor.id, 'rpwm', pin(9)), null);
  const stepper = addHardware(project, moduleFor('clex.hardware.tb6600'), catalog);
  assert.match(connectionProblem(stepper, catalog, motor.id, 'rpwm', pin(9)), /Timer1/);

  const noTrigger = withLogic(project, {
    ...project.logic,
    edges: project.logic.edges.filter(edge => !['trigger', 'stop'].includes(edge.targetHandle)),
  });
  assert.ok(validateGraph(noTrigger, catalog).some(issue => /сигнал запуска или остановки/.test(issue.message)));
});


test('BTS7960 shows both enable pins and permits a shared GPIO only for that pair', () => {
  const project = cameraMotorProject('esp32-cam');
  const board = motorBoards.find(item => item.id === project.boardId);
  const motor = project.components.find(item => item.moduleId === 'clex.hardware.bts7960');
  const driver = moduleFor(motor.moduleId);
  const logic = moduleFor('clex.logic.dc-motor');
  assert.equal(driver.name, 'BTS7960');
  assert.equal(driver.category, 'motor-drivers');
  assert.equal(logic.category, 'motion');
  assert.deepEqual(driver.terminals.filter(item => item.kind === 'motor-output').map(item => item.label), ['M+', 'M−']);

  const assignment = id => project.gpioAssignments.find(item => item.componentId === motor.id && item.terminalId === id);
  const enable = assignment('enable');
  assert.equal(assignment('enable-left').gpio, enable.gpio);
  assert.equal(connectionProblem(project, catalog, motor.id, 'enable-left', enable.pinId), null);
  assert.match(connectionProblem(project, catalog, motor.id, 'enable-left', assignment('rpwm').pinId), /одному GPIO/);
  assert.match(connectionProblem(project, catalog, motor.id, 'rpwm', enable.pinId), /уже назначен/);
  assert.match(connectionProblem(project, catalog, motor.id, 'motor-plus', board.pins.find(pin => pin.kind === 'ground').id),
    /к клемме драйвера/);

  const open = disconnectTerminal(project, catalog, motor.id, 'enable-left');
  assert.throws(() => generateFirmware(open, catalog), /подключите «L_EN»/);
  const legacy = {
    ...open,
    components: open.components.map(item => item.id === motor.id ? { ...item, moduleVersion: '1.0.0' } : item),
    moduleVersions: { ...open.moduleVersions, [motor.moduleId]: '1.0.0' },
  };
  legacy.gpioAssignments = gpioAssignments(legacy, catalog);
  const loaded = parseProject(serializeProject(legacy));
  assert.equal(mountedModule(loaded.components.find(item => item.id === motor.id), catalog).terminals
    .find(item => item.id === 'enable').label, 'R_EN + L_EN');
  assertValid(loaded);
  assert.match(generateFirmware(loaded, catalog).mainC, /gpio_set_level\(/);
});
