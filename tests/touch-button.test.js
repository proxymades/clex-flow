import test from 'node:test';import assert from 'node:assert/strict';
import {catalog}from './catalog-fixture.js';import{touchButtonProject}from './touch-button-fixture.js';
import{connectionProblem,disconnectTerminal,validateAssembly}from'../src/assembly/model.js';import{validateGraph,hardwareBinding,logicAdditionProblem}from'../src/logic/model.js';
import{generateFirmware}from'../src/firmware/generator.js';import{presentPort,nodeDisplayName}from'../src/logic/presentation.js';import{parseProject,serializeProject}from'../src/projects/model.js';
const boards=['waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'];
test('touch component uses VCC/GND/OUT and existing read/change blocks on S3, P4 and Nano',()=>{
 const module=catalog.modules.find(m=>m.id==='clex.hardware.touch-button');assert.equal(module.version,'1.0.0');assert.deepEqual(module.terminals.map(t=>t.label),['VCC','GND','OUT']);
 for(const id of boards){const{project,component,nodes}=touchButtonProject(id);assert.deepEqual([...validateAssembly(project,catalog),...validateGraph(project,catalog)].filter(i=>i.severity==='error'),[]);assert.equal(hardwareBinding(nodes.read,project,catalog).component.id,component.id);assert.equal(hardwareBinding(nodes.edge,project,catalog).error,null);assert.equal(logicAdditionProblem(catalog.modules.find(m=>m.id===nodes.read.moduleId),project,catalog),null);generateFirmware(project,catalog);}
});
test('HIGH/LOW and all bindings persist and generate normalized active states without a pull-up',()=>{
 for(const id of boards)for(const level of ['high','low']){
  const{project,component}=touchButtonProject(id,level);assert.deepEqual(parseProject(serializeProject(project)),project);const code=generateFirmware(project,catalog).mainC;const pin=project.gpioAssignments.find(a=>a.componentId===component.id).gpio;
  if(id.includes('nano-atmega')){assert.ok(code.includes(`pinMode(${pin}, INPUT)`));assert.ok(code.includes(`digitalRead(${pin}) ${level==='low'?'== LOW':'!= LOW'}`));}else{assert.match(code,/\.pull_up_en = GPIO_PULLUP_DISABLE/);assert.ok(code.includes(`gpio_get_level(${pin}) ${level==='low'?'== 0':'!= 0'}`));}
  assert.doesNotMatch(code,/TTP223|touch_pad|touch_sensor/);
 }
});
test('touch labels describe activation while generic read/edge IDs remain unchanged',()=>{
 for(const level of ['high','low']){const{project,nodes}=touchButtonProject(undefined,level);const module=catalog.modules.find(m=>m.id===nodes.edge.moduleId);assert.match(nodeDisplayName(nodes.edge,project,catalog),/События сенсора/);assert.equal(presentPort(module.outputs.find(p=>p.id==='rising'),nodes.edge,project,catalog).name,'Сенсор активирован');assert.equal(presentPort(module.outputs.find(p=>p.id==='falling'),nodes.edge,project,catalog).name,'Сенсор деактивирован');assert.equal(presentPort(module.outputs.find(p=>p.id==='level'),nodes.edge,project,catalog).name,'Сенсор активен?');}
});
test('ESP32 rejects 5V OUT and mismatched VCC; Nano accepts 5V configured supply and OUT',()=>{
 for(const id of boards){const{project,component}=touchButtonProject(id);const board=catalog.boards.find(b=>b.id===id),pin=project.assembly.connections.find(w=>w.terminalId==='signal').boardPinId;
  const power5=board.pins.find(p=>p.kind==='power'&&p.voltage===5);assert.ok(power5);assert.match(connectionProblem(project,catalog,component.id,'power',power5.id),/напряжением/);
  component.parameters.supplyVoltage='5';component.parameters.outputVoltage='5';assert.equal(connectionProblem(project,catalog,component.id,'power',power5.id),null);
  assert.equal(Boolean(connectionProblem(project,catalog,component.id,'signal',pin)),!id.includes('nano-atmega'));
  component.parameters.supplyVoltage='3.3';assert.ok(validateAssembly(project,catalog).some(i=>i.code==='input-voltage'));
 }
});
test('incomplete or invalid touch wiring prevents firmware generation',()=>{
 for(const terminal of ['power','ground','signal']){let{project,component}=touchButtonProject();project=disconnectTerminal(project,catalog,component.id,terminal);assert.throws(()=>generateFirmware(project,catalog),/схему/);}
 const{project,component}=touchButtonProject();component.parameters.activeLevel='unknown';assert.ok(validateAssembly(project,catalog).some(i=>i.code==='parameter-option'));assert.throws(()=>generateFirmware(project,catalog));
});
