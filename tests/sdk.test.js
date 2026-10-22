import test from 'node:test';
import assert from 'node:assert/strict';
import {sdkRequirement} from '../src/idf/sdkRequirements.js';
import {catalog} from './catalog-fixture.js';
import {choosePort} from '../src/idf/ports.js';
test('board determines ESP-IDF version, target and compiler without accepting commands',()=>{
 for(const board of catalog.boards.filter(board=>board.platform==='esp-idf')){const required=sdkRequirement(board);assert.equal(required.version,'5.4.4');assert.equal(required.target,board.target || 'esp32s3');assert.equal(required.family,'esp-idf');assert.match(required.compiler,board.target==='esp32p4'?/RISC-V/:/Xtensa/);}
 assert.equal(sdkRequirement({id:'future-stm32',mcu:'STM32'}),null);
});

test('Nano requests its own Arduino AVR toolchain',()=>{assert.deepEqual(sdkRequirement(catalog.boards.find(board=>board.target==='atmega328p')),{family:'arduino-avr',version:'1.8.6',target:'atmega328p',compiler:'AVR GCC',name:'Arduino AVR'});});

test('classic ESP32 requests ESP-IDF and uses detected serial ports without guessing between boards',()=>{
 const board=catalog.boards.find(board=>board.id==='doit-esp32-devkit-v1-30pin');
 assert.ok(board);
 assert.deepEqual(sdkRequirement(board),{family:'esp-idf',version:'5.4.4',target:'esp32',compiler:'Xtensa ESP32 GCC',name:'ESP-IDF'});
 assert.deepEqual(board.firmware.consoleModes,['uart']);
 for(const path of ['COM27','/dev/cu.usbserial-1130','/dev/ttyUSB0']){
  const port={path,usb:true};
  assert.equal(choosePort([port],''),path);
  assert.equal(choosePort([port,{path:'COM1',usb:false}],''),path);
  assert.equal(choosePort([port,{path:'another-board',usb:true}],''),'');
  assert.equal(choosePort([port,{path:'another-board',usb:true}],path),path);
  assert.equal(choosePort([],path),'');
 }
});
