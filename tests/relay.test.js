import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {relayProject} from './relay-fixture.js';
import {createProject,parseProject,serializeProject} from '../src/projects/model.js';
import {RELAY_MODULE,RELAY_SUPPLY_VOLTAGES,relayChannelCount,relayParameters,relaySupplyVoltage} from '../src/relay/model.js';
import {moduleFor,updateHardware,validateAssembly,connectionProblem,connectTerminal,disconnectTerminal,addHardware} from '../src/assembly/model.js';
import {terminalLayout} from '../src/assembly/terminalLayout.js';
import {assemblyRoutingScene} from '../src/assembly/routingScene.js';
import {contactInfo} from '../src/assembly/endpoints.js';
import {hardwareBinding,validateGraph,logicAdditionProblem} from '../src/logic/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
const boards=['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'];
const errors=p=>[...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(issue=>issue.severity==='error');
test('relay exposes selected channel count in mounting, endpoints and wire routing',()=>{
 for(const channels of Array.from({length:16},(_,i)=>String(i+1))){
  const {project,component}=relayProject({channels,connected:[1]});
  const module=moduleFor(component,catalog),layout=terminalLayout(module);
  assert.equal(layout.terminals.length,Number(channels)+2);
  assert.equal(relayChannelCount(component),Number(channels));
  assert.deepEqual(module.terminals.filter(t=>t.channel).map(t=>t.label),Array.from({length:Number(channels)},(_,i)=>'IN'+(i+1)));
  assert.ok(layout.terminals.every(t=>t.x>=0&&t.x<=layout.width&&t.y>=0&&t.y<=layout.height));
  assert.equal(contactInfo(project,catalog,component.id,'in'+channels).terminal.channel,Number(channels));
  assert.equal(contactInfo(project,catalog,component.id,'in'+(Number(channels)+1)).terminal,undefined);
  const scene=assemblyRoutingScene({...project.assembly,components:project.components},catalog.boards.find(b=>b.id===project.boardId),catalog);
  assert.equal(scene.nodes.find(n=>n.id===component.id).height,layout.height);
  assert.ok(scene.edges.every(e=>e.data.sourcePin&&e.data.targetTerminal));
  assert.deepEqual(errors(project),[]);
 }
});
test('relay generates independent output channels for LOW and HIGH on every current concrete board',()=>{
 for(const boardId of boards)for(const activeLevel of ['low','high']){
  const {project,blocks}=relayProject({boardId,activeLevel});
  assert.deepEqual(errors(project),[],boardId);
  assert.deepEqual(parseProject(serializeProject(project)),project);
  for(const block of blocks){const binding=hardwareBinding(block,project,catalog);assert.equal(binding.error,null);assert.equal(binding.gpio,project.gpioAssignments.find(a=>a.terminalId==='in'+block.parameters.channel).gpio);}
  const code=generateFirmware(project,catalog).mainC;
  assert.match(code,/static bool relay_state_0\[8\]/);
  assert.match(code,/relay_state_0\[0\] = false/);assert.match(code,/relay_state_0\[1\] = false/);
  const pin=project.gpioAssignments.find(a=>a.terminalId==='in1').gpio;
  const preload=catalog.boards.find(b=>b.id===boardId).platform==='arduino-avr'?`digitalWrite(${pin}, ${activeLevel==='low'?'HIGH':'LOW'});`:`gpio_set_level(${pin}, ${activeLevel==='low'?1:0})`;
  const output=catalog.boards.find(b=>b.id===boardId).platform==='arduino-avr'?`pinMode(${pin}, OUTPUT)`:`.pin_bit_mask = 1ULL << ${pin}`;
  assert.ok(code.indexOf(preload)<code.indexOf(output),boardId+' inactive level must precede output enable');
  assert.ok(code.includes(activeLevel==='low'?'!relay_state_0[0]':'gpio_set_level('+pin+', relay_state_0[0])')||catalog.boards.find(b=>b.id===boardId).platform==='arduino-avr');
 }
});
test('reducing relay channels frees only removed wires and sides; invalid logic channels remain explicit',()=>{
 let {project,component}=relayProject({channels:'8',connected:[1,8]});
 project.assembly.portSides={[component.id]:{in1:'left',in8:'right'}};
 const removed=project.assembly.connections.find(w=>w.terminalId==='in8'),remaining=project.assembly.connections.find(w=>w.terminalId==='in1');
 project=updateHardware(project,catalog,component.id,{parameters:{...component.parameters,channels:'4'}});
 assert.ok(!project.assembly.connections.some(w=>w.id===removed.id));assert.ok(project.assembly.connections.some(w=>w.id===remaining.id));
 assert.deepEqual(project.assembly.portSides[component.id],{in1:'left'});
 assert.equal(project.gpioAssignments.length,1);assert.equal(project.gpioAssignments[0].terminalId,'in1');
 for(const block of project.logic.nodes.filter(n=>n.moduleId==='clex.logic.relay'))assert.equal(Boolean(hardwareBinding(block,project,catalog).error),block.parameters.channel==='8');
 assert.throws(()=>generateFirmware(project,catalog),/существующий канал/);
 const restored=updateHardware(project,catalog,component.id,{parameters:{...project.components[0].parameters,channels:'8'}});
 assert.ok(!restored.assembly.connections.some(w=>w.terminalId==='in8'));
});
test('relay checks GPIO conflicts, supplies, unavailable channels and missing wiring',()=>{
 const {project,component,blocks}=relayProject();const board=catalog.boards.find(b=>b.id===project.boardId);
 const pin=project.assembly.connections.find(w=>w.terminalId==='in1').boardPinId;
 assert.match(connectionProblem(project,catalog,component.id,'in3',pin),/уже назначен/);
 const power3=board.pins.find(p=>p.kind==='power'&&p.voltage===3.3);
 assert.ok(connectionProblem(project,catalog,component.id,'power',power3.id));
 assert.ok(connectionProblem(project,catalog,component.id,'in9',pin));
 const inputOnly=board.pins.find(p=>p.kind==='gpio'&&!p.capabilities.includes('digital-output'));
 if(inputOnly)assert.ok(connectionProblem(project,catalog,component.id,'in3',inputOnly.id));
 for(const terminal of ['power','ground','in1'])assert.throws(()=>generateFirmware(disconnectTerminal(project,catalog,component.id,terminal),catalog));
 blocks[0].parameters.channel='0';assert.ok(hardwareBinding(blocks[0],project,catalog).error);blocks[0].parameters.channel='1';
 component.parameters.activeLevel='unknown';assert.ok(errors(project).some(i=>i.code==='parameter-option'));component.parameters.activeLevel='low';
 component.parameters.channels='17';assert.ok(errors(project).some(i=>i.code==='parameter-option'));
});
test('several relay modules keep separate bindings and duplicate GPIO is rejected',()=>{
 let {project,component,blocks}=relayProject({channels:'2'});
 project=addHardware(project,catalog.modules.find(m=>m.id===RELAY_MODULE),catalog);const other=project.components.at(-1);
 const pin=project.assembly.connections.find(w=>w.terminalId==='in1').boardPinId;
 assert.throws(()=>connectTerminal(project,catalog,other.id,'in1',pin),/уже назначен/);
 assert.equal(hardwareBinding(blocks[0],project,catalog).component.id,component.id);
 assert.ok(logicAdditionProblem(catalog.modules.find(m=>m.id==='clex.logic.relay'),createProject('Empty'),catalog));
});
test('relay settings affect firmware while visual placement does not',async()=>{
 const {project,component}=relayProject(),before=await firmwareFingerprint(generateFirmware(project,catalog));
 const moved=structuredClone(project);moved.assembly.positions[component.id]={x:1200,y:1000};moved.logic.nodes.reverse();moved.components.reverse();
 assert.equal(await firmwareFingerprint(generateFirmware(moved,catalog)),before);
 component.parameters.activeLevel='high';assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog)),before);
});

test('external relay power permits firmware without a board VCC wire while retaining ground and GPIO checks',()=>{
 for(const boardId of boards){
  let {project,component}=relayProject({boardId});
  const signals=structuredClone(project.gpioAssignments);
  project=updateHardware(project,catalog,component.id,{parameters:{...component.parameters,powerSource:'external'}});
  assert.ok(!project.assembly.connections.some(w=>w.terminalId==='power'));
  assert.deepEqual(project.gpioAssignments,signals);
  assert.deepEqual(errors(project),[]);generateFirmware(project,catalog);
  const restored=parseProject(serializeProject(project));assert.equal(restored.components[0].parameters.powerSource,'external');
  const power=moduleFor(restored.components[0],catalog).terminals.find(t=>t.id==='power');assert.equal(power.externalPower,true);assert.equal(power.optional,true);
  assert.match(connectionProblem(project,catalog,component.id,'power',catalog.boards.find(b=>b.id===boardId).pins.find(p=>p.kind==='power'&&p.voltage===5).id),/внешнего/);
  assert.throws(()=>generateFirmware(disconnectTerminal(project,catalog,component.id,'ground'),catalog));
  project=updateHardware(project,catalog,component.id,{parameters:{...project.components[0].parameters,powerSource:'board'}});
  assert.ok(errors(project).some(e=>e.code==='terminal-unconnected'&&e.message.includes('VCC')));
 }
});

test('ESP32-S3-ETH supply notes distinguish VSYS and VBUS without blocking GPIO control',()=>{
 const {project,component}=relayProject(),board=catalog.boards.find(b=>b.id===project.boardId);
 assert.match(board.pins.find(p=>p.id==='P39').powerNote,/после диода/);
 assert.match(board.pins.find(p=>p.id==='P40').powerNote,/USB VCC/);
 for(const pin of ['P39','P40']){
  const wired=connectTerminal(project,catalog,component.id,'power',pin);
  assert.equal(connectionProblem(wired,catalog,component.id,'power',pin),null);
  assert.ok(validateAssembly(wired,catalog).some(e=>e.code==='relay-power'&&e.severity==='warning'));
  assert.deepEqual(errors(wired),[]);generateFirmware(wired,catalog);
 }
 const fresh=addHardware(createProject('Relay external','',project.boardId,{camera:'disconnected'}),catalog.modules.find(m=>m.id===RELAY_MODULE),catalog);
 assert.equal(fresh.components[0].parameters.powerSource,'external');
});

test('relay board supplies must match selected 3.3/5V on every board and always report a warning',()=>{
 for(const boardId of boards)for(const supplyVoltage of ['3.3','5']){
  const {project,component}=relayProject({boardId,supplyVoltage});const board=catalog.boards.find(board=>board.id===boardId);
  assert.deepEqual(errors(project),[]);
  for(const pin of board.pins)assert.equal(connectionProblem(project,catalog,component.id,'power',pin.id)===null,pin.kind==='power'&&pin.voltage===Number(supplyVoltage),boardId+' '+supplyVoltage+' '+pin.id);
  const issue=validateAssembly(project,catalog).find(issue=>issue.code==='relay-power');
  assert.equal(issue.severity,'warning');assert.match(issue.message,/внешний источник/);
  const power=moduleFor(component,catalog).terminals.find(t=>t.id==='power');assert.equal(power.voltage,Number(supplyVoltage));
  generateFirmware(project,catalog);
 }
});
test('external power supports every relay voltage independently of GPIO logic and blocks high voltage from board',async()=>{
 for(const boardId of boards){
  const baseline=relayProject({boardId,supplyVoltage:'5',powerSource:'external'}).project;
  for(const supplyVoltage of RELAY_SUPPLY_VOLTAGES){
   const project=structuredClone(baseline),component=project.components[0];component.parameters.supplyVoltage=supplyVoltage;
   assert.deepEqual(errors(project),[]);
   assert.equal(relaySupplyVoltage(component),Number(supplyVoltage));
   assert.deepEqual(parseProject(serializeProject(project)),project);
   assert.equal(await firmwareFingerprint(generateFirmware(project,catalog)),await firmwareFingerprint(generateFirmware(baseline,catalog)));
   const definition=moduleFor(component,catalog),power=definition.terminals.find(t=>t.id==='power');
   assert.equal(power.optional,true);assert.equal(power.externalPower,true);assert.equal(power.externalPowerLabel,'Внешние '+supplyVoltage.replace('.',',')+' В');
   assert.equal(definition.parameters.powerSource.options.find(o=>o.value==='board').disabled,Number(supplyVoltage)>5);
   if(Number(supplyVoltage)>5){
    component.parameters.powerSource='board';
    const board=catalog.boards.find(board=>board.id===boardId);
    for(const pin of board.pins)assert.ok(connectionProblem(project,catalog,component.id,'power',pin.id),pin.id);
    assert.ok(errors(project).some(issue=>issue.code==='relay-power-source'));
    assert.throws(()=>generateFirmware(project,catalog),/внешний источник/);
   }
  }
 }
});
test('supply changes remove only incompatible VCC wiring and select external power above 5V',()=>{
 let {project,component}=relayProject();const board=catalog.boards.find(board=>board.id===project.boardId);
 const before=structuredClone(project.gpioAssignments),ground=project.assembly.connections.find(w=>w.terminalId==='ground');
 project=updateHardware(project,catalog,component.id,{parameters:{...component.parameters,supplyVoltage:'3.3'}});
 assert.equal(project.components[0].parameters.powerSource,'board');assert.ok(!project.assembly.connections.some(w=>w.terminalId==='power'));
 assert.deepEqual(project.gpioAssignments,before);assert.deepEqual(project.assembly.connections.find(w=>w.terminalId==='ground'),ground);
 assert.ok(errors(project).some(issue=>issue.code==='terminal-unconnected'&&issue.message.includes('VCC')));
 project=connectTerminal(project,catalog,component.id,'power',board.pins.find(pin=>pin.kind==='power'&&pin.voltage===3.3).id);
 assert.deepEqual(errors(project),[]);
 const configured=updateHardware(project,catalog,component.id,{parameters:{...project.components[0].parameters,supplyVoltage:'3.3'}});
 assert.deepEqual(configured.assembly.connections,project.assembly.connections);
 project=updateHardware(project,catalog,component.id,{parameters:{...project.components[0].parameters,supplyVoltage:'12'}});
 assert.equal(project.components[0].parameters.powerSource,'external');assert.ok(!project.assembly.connections.some(w=>w.terminalId==='power'));
 assert.deepEqual(project.gpioAssignments,before);assert.deepEqual(project.assembly.connections.find(w=>w.terminalId==='ground'),ground);
 assert.deepEqual(errors(project),[]);generateFirmware(project,catalog);
 project=updateHardware(project,catalog,component.id,{parameters:{...project.components[0].parameters,supplyVoltage:'24'}});
 assert.deepEqual(errors(project),[]);assert.deepEqual(project.gpioAssignments,before);
});
test('legacy relay projects retain 5V without rewriting files or changing firmware',()=>{
 const {project,component}=relayProject();const source=generateFirmware(project,catalog).mainC;
 delete component.parameters.supplyVoltage;
 const restored=parseProject(serializeProject(project)),old=restored.components[0];
 assert.equal(Object.hasOwn(old.parameters,'supplyVoltage'),false);
 assert.equal(relayParameters(old).supplyVoltage,'5');assert.equal(relaySupplyVoltage(old),5);
 assert.deepEqual(errors(restored),[]);assert.equal(generateFirmware(restored,catalog).mainC,source);
 assert.equal(moduleFor(old,catalog).terminals.find(t=>t.id==='power').voltage,5);
 assert.equal(Object.hasOwn(old.parameters,'supplyVoltage'),false);
});
test('invalid relay supply values cannot bypass validation and 5V GPIO to a 3.3V module is diagnosed',()=>{
 const {project,component}=relayProject({powerSource:'external'});
 for(const value of ['','0','4','13','230','3.30',3.3]){
  component.parameters.supplyVoltage=value;assert.equal(relaySupplyVoltage(component),0);
  assert.ok(errors(project).some(issue=>issue.code==='parameter-option'));assert.throws(()=>generateFirmware(project,catalog));
 }
 const nano=relayProject({boardId:'arduino-nano-atmega328p-ch340',supplyVoltage:'3.3',powerSource:'external'}).project;
 assert.ok(validateAssembly(nano,catalog).some(issue=>issue.code==='relay-logic-level'&&issue.severity==='warning'));assert.deepEqual(errors(nano),[]);
 component.parameters.supplyVoltage='12';component.parameters.powerSource='board';
 const renamed=updateHardware(project,catalog,component.id,{name:'Relay renamed'});
 assert.equal(renamed.components[0].parameters.powerSource,'board');assert.ok(errors(renamed).some(issue=>issue.code==='relay-power-source'));
});
