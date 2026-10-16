import test from 'node:test';
import assert from 'node:assert/strict';
import {nano,nanoProject} from './nano-fixture.js';
import {catalog} from './catalog-fixture.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {connectionProblem} from '../src/assembly/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
test('Nano has standard contacts, protected serial pins, analog-only A6/A7 and both bootloaders',()=>{
 const p=nanoProject({blink:true});assert.equal(nano.pins.length,30);assert.equal(nano.logicVoltage,5);
 assert.equal(p.components[0].parameters.resistorOhms,470);
 for(const id of ['D0','D1','A6','A7'])assert.ok(connectionProblem(p,catalog,p.components[0].id,'anode',id));
 assert.equal(moduleSupportsBoard(catalog.modules.find(m=>m.id==='clex.logic.display'),nano),false);
 assert.equal(moduleSupportsBoard(catalog.modules.find(m=>m.id==='clex.logic.counter'),nano),true);
});
test('Nano generates deterministic Arduino C++ for GPIO, counter, UTF-8 Serial and stopwatch without ESP-IDF',async()=>{
 for(const options of [{},{blink:true},{watch:true}]){
  const p=nanoProject(options),bundle=generateFirmware(p,catalog);
  assert.equal(bundle.platform,'arduino-avr');assert.equal(bundle.target,'atmega328p');
  assert.match(bundle.mainC,/void setup\(\)/);assert.match(bundle.mainC,/void loop\(\)/);assert.match(bundle.mainC,/Serial.begin\(115200\)/);
  assert.doesNotMatch(bundle.mainC,/freertos|esp_timer|ESP_LOG|lvgl/);
  assert.deepEqual(generateFirmware(parseProject(serializeProject(p)),catalog),bundle);
  assert.equal(await firmwareFingerprint(bundle),await firmwareFingerprint(generateFirmware(p,catalog)));
 }
});
test('Nano bootloader selection changes source identity, and SRAM-heavy messages fail before compilation',async()=>{
 const modern=generateFirmware(nanoProject(),catalog),old=generateFirmware(nanoProject({bootloader:'old'}),catalog);
 assert.notEqual(await firmwareFingerprint(modern),await firmwareFingerprint(old));
 const p=nanoProject();p.logic.nodes.find(n=>n.moduleId==='clex.logic.serial').parameters.message='я'.repeat(500);
 assert.throws(()=>generateFirmware(p,catalog),/памяти Nano/);
});
