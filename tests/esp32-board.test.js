import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalog} from './catalog-fixture.js';
import {createProject,parseProject,serializeProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem,pinProblem,validateAssembly} from '../src/assembly/model.js';

const board=catalog.boards.find(board=>board.id==='doit-esp32-devkit-v1-30pin');
const pin=gpio=>board.pins.find(pin=>pin.gpio===gpio);
const componentProject=moduleId=>{
 const module=catalog.modules.find(module=>module.id===moduleId);
 const project=addHardware(createProject('ESP32 DevKit V1','',board.id),module,catalog);
 return {project,component:project.components[0]};
};

test('ESP32 DevKit V1 identifies the 30-pin layout without claiming physical verification or native USB',()=>{
 assert.equal(board.target,'esp32');assert.equal(board.platform,'esp-idf');assert.equal(board.mcu,'ESP32-WROOM-32');
 assert.equal(board.pins.length,30);assert.equal(board.pinoutVerified,false);assert.equal(board.documentationVerified,true);
 assert.deepEqual(board.pins.filter(pin=>pin.side==='left').map(pin=>pin.gpio??pin.label),['EN',36,39,34,35,32,33,25,26,27,14,12,13,'GND','VIN']);
 assert.deepEqual(board.pins.filter(pin=>pin.side==='right').map(pin=>pin.gpio??pin.label),[23,22,1,3,21,19,18,5,17,16,4,2,15,'GND','3V3']);
 assert.equal(new Set(board.pins.map(pin=>pin.id)).size,30);
 assert.equal(board.firmware.flashSizeMb,4);assert.equal(board.firmware.psramMb,0);
 assert.deepEqual(board.firmware.consoleModes,['uart']);assert.deepEqual(board.interfaces.spi.hosts,[2,3]);
 for(const contact of board.pins){assert.ok(contact.x>0&&contact.x<board.width);assert.ok(contact.y>0&&contact.y<board.height);}
 const svg=readFileSync(new URL(`../src/catalog/assets/${board.svg}`,import.meta.url),'utf8');
 assert.ok(svg.includes(`viewBox="0 0 ${board.width} ${board.height}"`));assert.match(svg,/WROOM-32/);assert.match(svg,/USB-UART/);
});

test('classic ESP32 reserves flash, boot straps and UART0 while retaining WROOM GPIO16/17 and GPIO19',()=>{
 const {project,component}=componentProject('clex.hardware.led');
 for(const gpio of [1,2,3,5,12,15])assert.ok(connectionProblem(project,catalog,component.id,'anode',pin(gpio).id),`GPIO${gpio} reserved`);
 for(const gpio of [0,6,7,8,9,10,11]){
  assert.ok(board.reservedGpios[gpio]);assert.equal(board.pins.some(pin=>pin.gpio===gpio),false);
  assert.ok(pinProblem(project,{kind:'gpio',gpio},board));
 }
 for(const gpio of [4,13,14,16,17,18,19,21,22,23,25,26,27,32,33])assert.equal(connectionProblem(project,catalog,component.id,'anode',pin(gpio).id),null,`GPIO${gpio} usable`);
 for(const id of ['L1','L14','L15','R14','R15'])assert.ok(connectionProblem(project,catalog,component.id,'anode',id));
});

test('GPIO34/35/36/39 reject outputs and internal pull-up buttons, accept externally driven touch-module inputs',()=>{
 const led=componentProject('clex.hardware.led'),button=componentProject('clex.hardware.button'),touch=componentProject('clex.hardware.touch-button');
 for(const gpio of [34,35,36,39]){
  assert.deepEqual(pin(gpio).capabilities,['digital-input']);assert.equal(pin(gpio).internalPulls,false);
  assert.match(connectionProblem(led.project,catalog,led.component.id,'anode',pin(gpio).id),/направление/);
  assert.match(connectionProblem(button.project,catalog,button.component.id,'signal',pin(gpio).id),/подтяж/);
  assert.equal(connectionProblem(touch.project,catalog,touch.component.id,'signal',pin(gpio).id),null);
 }
 touch.component.parameters.outputVoltage='5';
 assert.match(connectionProblem(touch.project,catalog,touch.component.id,'signal',pin(34).id),/3.3/);
});

test('a mounted input-only touch module survives project export and invalid pull-up wiring is caught on import',()=>{
 let {project,component}=componentProject('clex.hardware.touch-button');
 for(const [terminal,contact] of [['signal',pin(34).id],['power','R15'],['ground','R14']])project=connectTerminal(project,catalog,component.id,terminal,contact);
 assert.equal(validateAssembly(project,catalog).filter(issue=>issue.severity==='error').length,0);
 const restored=parseProject(serializeProject(project));assert.equal(restored.boardId,board.id);assert.equal(restored.gpioAssignments[0].gpio,34);
 assert.deepEqual(restored.assembly.connections,project.assembly.connections);
 let button=componentProject('clex.hardware.button');
 button.project.assembly.connections=[{id:crypto.randomUUID(),componentId:button.component.id,terminalId:'signal',boardPinId:pin(34).id},{id:crypto.randomUUID(),componentId:button.component.id,terminalId:'ground',boardPinId:'R14'}];
 assert.ok(validateAssembly(button.project,catalog).some(issue=>issue.code==='connection-invalid'&&issue.message.includes('подтяж')));
});
