import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, serializeProject } from '../src/projects/model.js';
import { addHardware, connectTerminal, disconnectTerminal, removeHardware, selectBoard, validateAssembly, connectionProblem } from '../src/assembly/model.js';
import { catalog, eth, devkit, led, button } from './catalog-fixture.js';
const get = (board, gpio) => board.pins.find(pin => pin.gpio === gpio)?.id;
test('новые компоненты получают разные позиции и свободные имена после удаления', () => {
  let project = createProject('Модули');
  for (let i = 0; i < 5; i++) project = addHardware(project, led);
  const positions = project.components.map(component => JSON.stringify(project.assembly.positions[component.id]));
  assert.equal(new Set(positions).size, 5);
  project = removeHardware(project, catalog, project.components[1].id);
  project = addHardware(project, led);
  assert.equal(new Set(project.components.map(component => component.name)).size, 5);
  assert.equal(new Set(project.components.map(component => JSON.stringify(project.assembly.positions[component.id]))).size, 5);
  serializeProject(project);
});
function assembly() {
  let project = addHardware(createProject('Blink'), led);
  const id = project.components[0].id;
  project = connectTerminal(project, catalog, id, 'anode', get(eth, 17));
  project = connectTerminal(project, catalog, id, 'cathode', 'P28');
  return project;
}

test('контакты ETH соответствуют официальной ориентации и отдельным шинам питания', () => {
  assert.equal(eth.pins.length, 40);
  for (const [id, label] of [['P1','GPIO20'],['P20','GPIO33'],['P21','GPIO43'],['P40','VBUS'],['P36','3V3'],['P37','3V3_EN']]) assert.equal(eth.pins.find(pin => pin.id === id).label,label);
  assert.equal(eth.pins.find(pin => pin.id === 'P1').side,'right');
  assert.equal(eth.pins.find(pin => pin.id === 'P40').side,'left');
  assert.equal(eth.pinoutVerified,false); assert.equal(eth.revision,null);
  assert.equal(devkit.pins.length,44); assert.ok(devkit.pins.find(pin => pin.gpio === 38).reservedReason);
  for (const board of catalog.boards) {
    assert.equal(new Set(board.pins.map(pin => pin.id)).size,board.pins.length);
    for (const pin of board.pins) { assert.ok(pin.x >= 0 && pin.x < board.width); assert.ok(pin.y >= 0 && pin.y < board.height); if (pin.kind !== 'gpio') assert.equal(pin.capabilities.length,0); }
    if (board.svg) assert.match(readFileSync(new URL(`../src/catalog/assets/${board.svg}`,import.meta.url),'utf8'), /<svg/);
  }
});
test('LED на GPIO17 и GND не имеет ошибок монтажа, ревизия остаётся предупреждением', () => {
  const project = assembly(), issues = validateAssembly(project,catalog);
  assert.equal(issues.filter(issue=>issue.severity==='error').length,0);
  assert.ok(issues.some(issue=>issue.code==='revision-unconfirmed'));
  assert.equal(project.gpioAssignments[0].gpio,17); assert.equal(project.gpioAssignments[0].mode,'output');
});
test('питание и управляющие контакты не принимаются как GPIO или GND', () => {
  const project=addHardware(createProject('LED'),led), id=project.components[0].id;
  for (const pin of ['P40','P39','P36','P37','P30']) {
    assert.throws(()=>connectTerminal(project,catalog,id,'anode',pin));
    assert.throws(()=>connectTerminal(project,catalog,id,'cathode',pin));
  }
  assert.throws(()=>connectTerminal(project,catalog,id,'anode','P28'));
  assert.throws(()=>connectTerminal(project,catalog,id,'cathode',get(eth,17)));
});
test('strapping, USB, UART, RGB и octal PSRAM запрещены', () => {
  const project=addHardware(createProject('LED'),led), id=project.components[0].id;
  for (const gpio of [0,3,19,20,21,33,34,35,36,37,43,44,45,46]) assert.throws(()=>connectTerminal(project,catalog,id,'anode',get(eth,gpio)),`GPIO${gpio}`);
});
test('контакты камеры недоступны при неизвестной конфигурации и подключённой камере', () => {
  const project=addHardware(createProject('LED'),led), id=project.components[0].id;
  for (const camera of ['unknown','connected']) for (const gpio of [1,2,15,16,18,38,39,40,41,42,47,48]) assert.throws(()=>connectTerminal({...project,boardSettings:{camera}},catalog,id,'anode',get(eth,gpio)));
  const disconnected=connectTerminal({...project,boardSettings:{camera:'disconnected'}},catalog,id,'anode',get(eth,16));
  assert.equal(disconnected.gpioAssignments[0].gpio,16);
  assert.ok(validateAssembly({...disconnected,boardSettings:{camera:'connected'}},catalog).some(issue=>issue.code==='connection-invalid'));
});
test('повторный GPIO отклоняется; общий GND может быть разделён компонентами', () => {
  let project=addHardware(assembly(),button); const id=project.components[1].id;
  assert.throws(()=>connectTerminal(project,catalog,id,'signal',get(eth,17)),/уже назначен/);
  project={...project,boardSettings:{camera:'disconnected'}};
  project=connectTerminal(project,catalog,id,'signal',get(eth,16));
  project=connectTerminal(project,catalog,id,'ground','P28');
  assert.equal(validateAssembly(project,catalog).filter(issue=>issue.severity==='error').length,0);
  assert.equal(project.gpioAssignments.length,2);
});
test('GPIO с возможностью только ввода не принимает выход светодиода', () => {
  const board={...eth,pins:eth.pins.map(pin=>pin.gpio===46?{...pin,reservedReason:null,sharedWith:null}:pin)};
  const custom={...catalog,boards:[board]};
  const project=addHardware(createProject('LED'),led), id=project.components[0].id;
  assert.match(connectionProblem(project,custom,id,'anode',get(eth,46)),/направление/);
});
test('переназначение заменяет одну связь и синхронизирует GPIO', () => {
  let project=assembly(); const id=project.components[0].id, previous=project.assembly.connections[0].id;
  project=connectTerminal({...project,boardSettings:{camera:'disconnected'}},catalog,id,'anode',get(eth,16));
  assert.equal(project.assembly.connections.length,2); assert.equal(project.assembly.connections.at(-1).id,previous); assert.equal(project.gpioAssignments[0].gpio,16);
  project=disconnectTerminal(project,catalog,id,'anode'); assert.equal(project.gpioAssignments.length,0); assert.equal(project.assembly.connections.length,1);
});
test('удаление компонента очищает связи, позиции и больше не используемые версии', () => {
  let project=assembly(); const id=project.components[0].id;
  project=removeHardware(project,catalog,id);
  assert.equal(project.components.length,0); assert.equal(project.assembly.connections.length,0); assert.equal(project.gpioAssignments.length,0); assert.equal(Object.keys(project.moduleVersions).length,0); assert.equal(project.assembly.positions[id],undefined); serializeProject(project);
});
test('смена платы очищает GPIO и связи, сохраняя компоненты и параметры', () => {
  const project=assembly(), next=selectBoard(project,devkit);
  assert.equal(next.boardId,devkit.id); assert.equal(next.assembly.connections.length,0); assert.equal(next.gpioAssignments.length,0); assert.deepEqual(next.components,project.components); serializeProject(next);
});
test('неподключённые контакты, неверный резистор и параметры обнаруживаются', () => {
  const project=addHardware(createProject('LED'),led);
  assert.equal(validateAssembly(project,catalog).filter(issue=>issue.code==='terminal-unconnected').length,2);
  for (const resistorOhms of [0,100,-1]) {
    const invalid={...project,components:[{...project.components[0],parameters:{resistorOhms,forwardVoltage:2}}]};
    assert.ok(validateAssembly(invalid,catalog).some(issue=>issue.code==='parameter-range'));
  }
  const tooMuch={...project,components:[{...project.components[0],parameters:{resistorOhms:100,forwardVoltage:2}}]};
  assert.ok(validateAssembly(tooMuch,catalog).some(issue=>issue.code==='led-current'));
});
test('неизвестная плата, отсутствующий модуль, несовместимая версия и рассинхронизация GPIO видны', () => {
  const project=assembly();
  assert.ok(validateAssembly({...project,boardId:'missing'},catalog).some(issue=>issue.code==='board-missing'));
  assert.ok(validateAssembly(project,{...catalog,modules:[]}).some(issue=>issue.code==='module-compatibility'));
  const future={...project,components:project.components.map(component=>({...component,moduleVersion:'2.0.0'})),moduleVersions:{[led.id]:'2.0.0'}};
  assert.ok(validateAssembly(future,catalog).some(issue=>issue.code==='module-compatibility')); serializeProject(future);
  assert.ok(validateAssembly({...project,gpioAssignments:[]},catalog).some(issue=>issue.code==='gpio-cache'));
});
