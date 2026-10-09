import test from 'node:test';
import assert from 'node:assert/strict';
import {sdkRequirement} from '../src/idf/sdkRequirements.js';
import {catalog} from './catalog-fixture.js';
test('board determines ESP-IDF version, target and compiler without accepting commands',()=>{
 for(const board of catalog.boards){const required=sdkRequirement(board);assert.equal(required.version,'5.4.4');assert.equal(required.target,'esp32s3');assert.equal(required.family,'esp-idf');assert.match(required.compiler,/Xtensa/);}
 assert.equal(sdkRequirement({id:'future-stm32',mcu:'STM32'}),null);
});
