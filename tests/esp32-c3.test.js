import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalog} from './catalog-fixture.js';
import {C3_BOARD,c3GpioProject,c3Cases} from './esp32-c3-fixture.js';
import {createProject,parseProject,serializeProject} from '../src/projects/model.js';
import {validateAssembly,connectionProblem,addHardware} from '../src/assembly/model.js';
import {validateGraph} from '../src/logic/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {sdkRequirement} from '../src/idf/sdkRequirements.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
import {selectableBoards} from '../src/catalog/boardSelection.js';
const board=catalog.boards.find(b=>b.id===C3_BOARD);
test('C3 Super Mini has the documented component-side pin order and its own RISC-V target',()=>{
 assert.equal(board.target,'esp32c3');assert.equal(board.revision,null);assert.equal(board.pinoutVerified,false);assert.equal(board.documentationVerified,true);
 assert.deepEqual(board.pins.filter(p=>p.side==='left').map(p=>p.gpio),[5,6,7,8,9,10,20,21]);
 assert.deepEqual(board.pins.filter(p=>p.side==='right').map(p=>p.gpio??p.label),['5V','GND','3V3',4,3,2,1,0]);
 assert.equal(new Set(board.pins.map(p=>p.id)).size,16);assert.deepEqual(board.interfaces.spi.hosts,[2]);assert.equal(board.resources.gptimer,2);
 assert.equal(board.firmware.flashSizeMb,4);assert.equal(board.firmware.psramMb,0);assert.deepEqual(board.firmware.consoleModes,['usb','uart']);
 assert.equal(sdkRequirement(board).target,'esp32c3');assert.match(sdkRequirement(board).compiler,/RISC-V/);
 assert.equal(selectableBoards(catalog.boards,{query:'ESP32 C3 Super Mini'})[0].id,C3_BOARD);
 const svg=readFileSync(new URL('../src/catalog/assets/'+board.svg,import.meta.url),'utf8');assert.match(svg,/viewBox="0 0 480 440"/);
});
test('C3 prevents boot, LED and UART conflicts and permits ordinary GPIO without exposing USB or flash pads',()=>{
 const p=c3GpioProject(),led=p.components[0];
 // Use an empty mounting to test every GPIO independently of existing connections.
 const empty=addHardware(createProject('Pins','',C3_BOARD),catalog.modules.find(m=>m.id==='clex.hardware.led'),catalog),c=empty.components[0];
 for(const gpio of [2,8,9,20,21])assert.ok(connectionProblem(empty,catalog,c.id,'anode',board.pins.find(p=>p.gpio===gpio).id));
 for(const gpio of [0,1,3,4,5,6,7,10])assert.equal(connectionProblem(empty,catalog,c.id,'anode',board.pins.find(p=>p.gpio===gpio).id),null);
 for(const gpio of [11,12,13,14,15,16,17,18,19]){assert.ok(board.reservedGpios[gpio]);assert.equal(board.pins.some(p=>p.gpio===gpio),false);}
 p.assembly.connections.find(w=>w.componentId===led.id&&w.terminalId==='anode').boardPinId='L4';
 assert.ok(validateAssembly(p,catalog).some(i=>i.severity==='error'&&i.message.includes('strapping')));
 assert.throws(()=>generateFirmware(p,catalog));
});
test('C3 firmware and saved projects retain GPIO, SPI, radio and network settings for both consoles',()=>{
 for(const [name,p]of c3Cases())for(const consoleMode of ['usb','uart']){
  assert.deepEqual([...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(i=>i.severity==='error'),[],name);
  const reopened=parseProject(serializeProject(p));assert.deepEqual(reopened,p);
  const b=generateFirmware(reopened,catalog,consoleMode);assert.equal(b.target,'esp32c3');assert.equal(b.consoleMode,consoleMode);
  assert.match(b.files['sdkconfig.defaults'],/CONFIG_IDF_TARGET="esp32c3"/);assert.match(b.files['sdkconfig.defaults'],/CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y/);
  assert.match(b.files['sdkconfig.defaults'],consoleMode==='usb'?/CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y/:/CONFIG_ESP_CONSOLE_UART_DEFAULT=y/);
  assert.ok(b.featureRuntimes.every(key=>key.endsWith('esp32c3')),name);assert.doesNotMatch(b.mainC,/@[A-Z_]+@/);
 }
});
test('C3 hides peripherals without a driver and rejects SPI3 and oversized OTA',()=>{
 for(const id of ['clex.hardware.voice','clex.logic.voice','clex.hardware.ethernet','clex.logic.ethernet','clex.hardware.audio','clex.hardware.camera'])assert.equal(moduleSupportsBoard(catalog.modules.find(m=>m.id===id),board),false,id);
 const p=c3Cases().find(([name])=>name==='display')[1];p.components.at(-1).parameters.spiHost='3';assert.throws(()=>generateFirmware(p,catalog),/SPI/);
 const router=c3Cases().find(([name])=>name==='router')[1];router.components.find(c=>c.moduleId==='clex.hardware.router').parameters.otaEnabled=true;assert.throws(()=>generateFirmware(router,catalog),/8 МБ/);
});

test('C3 limits stepper drivers to its two GPTimers',()=>{
 let p=createProject('Timer resources','',C3_BOARD);
 const driver=catalog.modules.find(m=>m.id==='clex.hardware.drv8825');
 for(let i=0;i<3;i++){
  p=addHardware(p,driver,catalog);
  const overBudget=validateAssembly(p,catalog).filter(i=>i.code==='stepper-count');
  assert.equal(overBudget.length>0,i===2);
 }
});
