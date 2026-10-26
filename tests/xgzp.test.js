import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {xgzpProject,mountXgzp,XGZP_BOARDS} from './xgzp-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {serializeProject,parseProject,migrateProject} from '../src/projects/model.js';
import {validateAssembly,connectionProblem,addHardware} from '../src/assembly/model.js';
import {addNode,withLogic,validateGraph} from '../src/logic/model.js';
import {connectDisplayData} from '../src/logic/displayBindings.js';
import {peripheralProject} from './peripheral-fixture.js';
import {terminalLayout} from '../src/assembly/terminalLayout.js';
import {resourceClaims,resourceIssues} from '../src/hardware/resources.js';
const errors=p=>[...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(i=>i.severity==='error');

test('XGZP generates a persisted 0x6D sensor with K=16 on every supported physical board',()=>{
 for(const boardId of XGZP_BOARDS){
  const {project:p}=xgzpProject(boardId);
  assert.deepEqual(errors(p),[]);
  const fw=generateFirmware(p,catalog);
  assert.match(fw.mainC,/\.k=16/);
  assert.match(fw.mainC,/clex_xgzp_request/);
  assert.match(fw.mainC,/clex_xgzp_snapshot/);
  assert.deepEqual(parseProject(serializeProject(p)),p);
  if(fw.platform==='arduino-avr')assert.match(fw.mainC,/Wire.setWireTimeout\(25000, true\)/);
  else assert.match(fw.files['main/CMakeLists.txt'],/esp_driver_i2c/);
 }
});
test('XGZP rejects missing calibration, wrong power/logic levels, Nano pins and duplicate address',()=>{
 const {project:p,component:c}=xgzpProject();
 c.parameters.kFactor='';assert.ok(errors(p).some(i=>i.code==='xgzp-config'));c.parameters.kFactor='16';
 c.parameters.supplyVoltage='5';assert.ok(errors(p).some(i=>i.code==='xgzp-config'));
 c.parameters.levelShifter='converter';assert.ok(errors(p).some(i=>i.code==='xgzp-config'));
 assert.throws(()=>generateFirmware(p,catalog),/3,3 В/);
 c.parameters.supplyVoltage='3.3';
 assert.throws(()=>xgzpProject(XGZP_BOARDS[0],{supply:'5'}),/3,3 В/);
 const n=xgzpProject(XGZP_BOARDS[4]);
 assert.match(connectionProblem(n.project,catalog,n.component.id,'sda','D2'),/A4/);
 assert.match(connectionProblem(n.project,catalog,n.component.id,'scl','A4'),/A5/);
 n.component.parameters.i2cPort='1';assert.ok(errors(n.project).some(i=>i.message.includes('Wire')));
 const camera=xgzpProject('waveshare-esp32-s3-eth').project;camera.boardSettings.camera='connected';
 assert.ok(errors(camera).some(i=>i.code==='connection-invalid'));
 const duplicate=addHardware(p,catalog.modules.find(m=>m.id===c.moduleId),catalog);duplicate.components.at(-1).parameters.i2cPort='0';
 assert.ok(errors(duplicate).some(i=>i.message.includes('0x6D уже занят')));
});
test('XGZP bus is exclusive on unrelated GPIO but can share a matching board peripheral bus',()=>{
 const {project:p,component:c}=xgzpProject();
 const board=catalog.boards.find(b=>b.id===p.boardId),pin=board.pins.find(pin=>pin.gpio===21);
 const led=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.led'),catalog);
 assert.match(connectionProblem(led,catalog,led.components.at(-1).id,'anode',pin.id),/используется|занят/);
 assert.ok(resourceClaims(p,catalog).some(claim=>claim.componentId===c.id&&claim.key==='i2c:0'));
 let q=peripheralProject({network:false,camera:false});
 q=mountXgzp(q,{sda:7,scl:8,port:'0'}).project;
 assert.deepEqual(resourceIssues(q,catalog),[]);
 assert.deepEqual(errors(q),[]);
 const fw=generateFirmware(q,catalog);
 assert.equal(fw.mainC.match(/\{0,7,8,NULL\}/g)?.length,1);
 assert.match(fw.mainC,/\.device_address=0x6d/);
});
test('multiple logic blocks share a physical conversion and manual mode removes automatic reads',()=>{
 let {project:p,sensor}=xgzpProject();
 p=withLogic(p,addNode(p.logic,catalog.modules.find(m=>m.id===sensor.moduleId),p.components,p,catalog));
 p.logic.nodes.at(-1).parameters.autoRead=false;
 const source=generateFirmware(p,catalog).mainC;
 assert.equal(source.match(/\.slot=0, .k=16/g).length,1);
 assert.equal(source.match(/clex_xgzp_request\(&clex_xgzp_sensors\[0\]/g).length,2);
 assert.equal(source.match(/\.scheduled=true/g).length,1);
});

test('XGZP pressure and temperature update ordinary display fields with matching font glyphs',()=>{
 let p=peripheralProject({network:false,camera:false});
 p=mountXgzp(p,{sda:4,scl:5}).project;
 assert.equal(p.components.at(-1).parameters.i2cPort,'1');
 p=withLogic(p,addNode(p.logic,catalog.modules.find(m=>m.id==='clex.logic.xgzp6847d'),p.components,p,catalog));
 const sensor=p.logic.nodes.at(-1),view=p.logic.nodes.find(n=>n.moduleId==='clex.logic.display');
 for(const [id,port,y] of [['pressure','text',20],['temperature','temperatureText',60]]){
  p.screens[view.parameters.componentId].elements.push({id,name:id,type:'text',text:'',mode:'dynamic',valueType:'text',initialValue:'Нет данных',prefix:'',suffix:'',x:10,y,fontId:'montserrat_20',color:'#ffffff'});
  p=withLogic(p,connectDisplayData(p,catalog,{source:sensor.id,sourceHandle:port,target:view.id,targetHandle:id}));
 }
 assert.deepEqual(errors(p),[]);
 const fw=generateFirmware(p,catalog);
 assert.match(fw.mainC,/clex_graphics_set_text\([^\n]+xgzp_value_\d+\.text\)/);
 assert.match(fw.mainC,/clex_graphics_set_text\([^\n]+xgzp_value_\d+\.temperatureText\)/);
});

test('XGZP restricts power contacts by board and rejects unsafe saved wiring even with legacy converter settings',()=>{
 for(const boardId of XGZP_BOARDS){
  const {project:p,component:c}=xgzpProject(boardId);
  const board=catalog.boards.find(b=>b.id===boardId),allowed=board.logicVoltage||3.3;
  const powerPins=board.pins.filter(pin=>pin.kind==='power');
  for(const pin of powerPins){
   assert.equal(Boolean(connectionProblem(p,catalog,c.id,'power',pin.id)),pin.voltage!==allowed,boardId+' '+pin.id);
  }
  const unsafe=powerPins.find(pin=>pin.voltage!==(allowed));
  assert.ok(unsafe);
  const wire=p.assembly.connections.find(w=>w.componentId===c.id&&w.terminalId==='power');
  wire.boardPinId=unsafe.id;
  assert.ok(errors(p).some(i=>i.code==='connection-invalid'));
  assert.throws(()=>generateFirmware(p,catalog),/VDD/);
  c.parameters.supplyVoltage=String(unsafe.voltage);c.parameters.levelShifter='converter';
  assert.ok(errors(p).some(i=>i.code==='xgzp-config'));
  assert.throws(()=>generateFirmware(p,catalog));
 }
});

test('DIP6 pinout matches XGZP6847D and NC contacts cannot be wired',()=>{
 const hardware=catalog.modules.find(m=>m.id==='clex.hardware.xgzp6847d');
 assert.equal(hardware.name,'XGZP6847D');
 assert.equal(hardware.terminals.length,6);
 const layout=terminalLayout(hardware,{power:'left',sda:'left'});
 assert.equal(new Set(layout.terminals.filter(t=>t.side==='left').map(t=>t.y)).size,5);
 assert.deepEqual([...hardware.terminals].sort((a,b)=>a.physicalNumber-b.physicalNumber).map(t=>[t.physicalNumber,t.id]),[[1,'scl'],[2,'nc2'],[3,'ground'],[4,'power'],[5,'sda'],[6,'nc6']]);
 for(const boardId of XGZP_BOARDS){
  const {project:p,component:c}=xgzpProject(boardId),board=catalog.boards.find(b=>b.id===boardId);
  for(const id of ['nc2','nc6'])for(const pin of board.pins)assert.match(connectionProblem(p,catalog,c.id,id,pin.id),/NC/);
  c.parameters.kFactor='4';assert.deepEqual(errors(p),[]);assert.match(generateFirmware(p,catalog).mainC,/\.k=4/);
 }
});
test('saved sensor projects migrate IDs and generated names without changing wires, parameters or custom names',()=>{
 const {project:p}=xgzpProject();
 const expected=generateFirmware(p,catalog).mainC;
 const legacy=structuredClone(p);
 for(const item of [...legacy.components,...legacy.logic.nodes])if(item.moduleId.includes('xgzp6847d')){item.moduleId=item.moduleId.replace('6847','6897');item.name=item.name.replace('6847','6897');}
 legacy.moduleVersions=Object.fromEntries(Object.entries(legacy.moduleVersions).map(([id,v])=>[id.replace('6847','6897'),v]));
 const before=JSON.stringify(legacy),migrated=migrateProject(legacy);
 assert.equal(JSON.stringify(legacy),before);
 assert.equal(migrated.components[0].name,'XGZP6847D 1');
 assert.equal(migrated.logic.nodes[0].name,'XGZP6847D – Измерение 1');
 assert.deepEqual(migrated.assembly,p.assembly);assert.deepEqual(migrated.gpioAssignments,p.gpioAssignments);
 assert.deepEqual(migrated.logic.edges,p.logic.edges);assert.deepEqual(migrated.components[0].parameters,p.components[0].parameters);
 assert.deepEqual(migrated.moduleVersions,p.moduleVersions);
 assert.deepEqual(errors(migrated),[]);assert.equal(generateFirmware(migrated,catalog).mainC,expected);
 legacy.components[0].name='Давление насоса';legacy.logic.nodes[0].name='Измерить давление';
 const loaded=parseProject(JSON.stringify(legacy));
 assert.equal(loaded.components[0].name,'Давление насоса');assert.equal(loaded.logic.nodes[0].name,'Измерить давление');
 assert.deepEqual(parseProject(serializeProject(loaded)),loaded);
});
