import test from 'node:test';
import assert from 'node:assert/strict';
import {sdkRequirement} from '../src/idf/sdkRequirements.js';
import {catalog} from './catalog-fixture.js';
test('board determines ESP-IDF version, target and compiler without accepting commands',()=>{
 for(const board of catalog.boards.filter(board=>board.platform==='esp-idf')){const required=sdkRequirement(board);assert.equal(required.version,'5.4.4');assert.equal(required.target,board.target || 'esp32s3');assert.equal(required.family,'esp-idf');assert.match(required.compiler,board.target==='esp32p4'?/RISC-V/:/Xtensa/);}
 assert.equal(sdkRequirement({id:'future-stm32',mcu:'STM32'}),null);
});

test('Nano requests its own Arduino AVR toolchain',()=>{assert.deepEqual(sdkRequirement(catalog.boards.find(board=>board.target==='atmega328p')),{family:'arduino-avr',version:'1.8.6',target:'atmega328p',compiler:'AVR GCC',name:'Arduino AVR'});});
