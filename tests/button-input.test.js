import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {BUTTON_BOARDS,buttonInputProject} from './button-input-fixture.js';
import {addHardware,connectTerminal,disconnectTerminal,removeHardware,validateAssembly,connectionProblem,gpioAssignments,updateHardware} from '../src/assembly/model.js';
import {componentContact} from '../src/assembly/endpoints.js';
import {validateGraph,hardwareBinding} from '../src/logic/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {openProject} from '../src/projects/upgrade.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {electricalModel,ledResistance} from '../src/electrical/model.js';
import {inputActiveLow} from '../src/buttons/model.js';
import {wireColors,POWER_COLOR} from '../src/assembly/wireColors.js';
const errors=p=>[...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(i=>i.severity==='error');
const definition=id=>catalog.modules.find(m=>m.id===id);

test('simple buttons generate the selected polarity and internal/external pulls on every current board',()=>{
 for(const boardId of BUTTON_BOARDS)for(const pull of ['up','down','external-up','external-down']){
  if(boardId.startsWith('arduino')&&pull==='down')continue;
  const {project,button,input}=buttonInputProject({boardId,pull});
  assert.deepEqual(errors(project),[],boardId+' '+pull);
  assert.deepEqual(parseProject(serializeProject(project)),project);
  assert.equal(project.gpioAssignments.length,2);
  const bundle=generateFirmware(project,catalog),source=bundle.mainC,low=!pull.endsWith('down');
  assert.equal(inputActiveLow(button),low);
  if(bundle.platform==='arduino-avr'){
   assert.ok(source.includes('digitalRead('+input.gpio+') '+(low?'== LOW':'!= LOW')));
   assert.ok(source.includes('pinMode('+input.gpio+', '+(pull==='up'?'INPUT_PULLUP':'INPUT')+')'));
  }else{
   assert.ok(source.includes('gpio_get_level('+input.gpio+') '+(low?'== 0':'!= 0')));
   const config=source.split('\n').find(line=>line.includes('.pin_bit_mask = 1ULL << '+input.gpio+','));
   assert.match(config,pull==='up'?/pull_up_en = GPIO_PULLUP_ENABLE/:/pull_up_en = GPIO_PULLUP_DISABLE/);
   assert.match(config,pull==='down'?/pull_down_en = GPIO_PULLDOWN_ENABLE/:/pull_down_en = GPIO_PULLDOWN_DISABLE/);
  }
 }
});

test('button modules reuse the existing input blocks with onboard, active-output and GPIO pull settings',()=>{
 for(const boardId of BUTTON_BOARDS)for(const pull of ['module','none','up','down','external-up','external-down'])for(const activeLevel of ['low','high']){
  if(boardId.startsWith('arduino')&&pull==='down')continue;
  if(!['module','none'].includes(pull)&&(pull.endsWith('down')?activeLevel==='low':activeLevel==='high'))continue;
  const {project,button,edge}=buttonInputProject({boardId,module:true,pull,activeLevel});
  assert.deepEqual(errors(project),[],boardId+' '+pull+' '+activeLevel);
  assert.equal(button.parameters.supplyVoltage,boardId.startsWith('arduino')?'5':'3.3');
  assert.equal(project.logic.nodes.length,2);assert.equal(hardwareBinding(edge,project,catalog).component.id,button.id);
  assert.deepEqual(openProject(serializeProject(project),catalog),{project,upgraded:false});
  generateFirmware(project,catalog);
 }
});

test('external pulls require the correct connected resistor and survive either end order and both wiring styles',()=>{
 for(const pull of ['external-up','external-down'])for(const branch of ['board','component'])for(const swapped of [false,true]){
  const fixture=buttonInputProject({pull,branch,swapped}),{project,button,resistor}=fixture;
  assert.deepEqual(errors(project),[]);
  assert.equal(project.gpioAssignments.some(a=>a.componentId===resistor.id),false);
  assert.equal(electricalModel(project,catalog).attached(button.id,'signal').length,1);
  for(const end of ['a','b']){
   const broken=disconnectTerminal(project,catalog,resistor.id,end);
   assert.ok(validateAssembly(broken,catalog).some(i=>i.code==='button-pull-resistor'));
   assert.throws(()=>generateFirmware(broken,catalog),/резистор/);
  }
  const removed=removeHardware(project,catalog,resistor.id);assert.ok(validateAssembly(removed,catalog).some(i=>i.code==='button-pull-resistor'));
  const unrelated=buttonInputProject({pull,resistor:false});let p=addHardware(unrelated.project,definition('clex.hardware.resistor'),catalog);const r=p.components.at(-1);
  p=connectTerminal(p,catalog,r.id,'a',unrelated.output.id);p=connectTerminal(p,catalog,r.id,'b',unrelated.power.id);
  assert.ok(validateAssembly(p,catalog).some(i=>i.code==='button-pull-resistor'));
 }
});

test('wrong rails, excessive OUT voltage, opposing pulls, small pull resistors and floating common contacts block generation',()=>{
 const f=buttonInputProject({pull:'external-up',branch:'board'});
 let p=connectTerminal(f.project,catalog,f.resistor.id,'b',f.ground.id);
 assert.ok(validateAssembly(p,catalog).some(i=>i.code==='button-pull-direction'));assert.throws(()=>generateFirmware(p,catalog));
 const five=catalog.boards.find(b=>b.id===p.boardId).pins.find(pin=>pin.voltage===5);
 p=connectTerminal(f.project,catalog,f.resistor.id,'b',five.id);assert.ok(validateAssembly(p,catalog).some(i=>i.code==='button-pull-voltage'));
 p=updateHardware(f.project,catalog,f.resistor.id,{parameters:{resistanceOhms:100}});assert.ok(validateAssembly(p,catalog).some(i=>i.code==='button-pull-resistance'));
 p=disconnectTerminal(f.project,catalog,f.button.id,'ground');assert.ok(validateAssembly(p,catalog).some(i=>i.code==='button-common'));
 const m=buttonInputProject({module:true,pull:'up',activeLevel:'high'});assert.ok(validateAssembly(m.project,catalog).some(i=>i.code==='button-active-level'));
 m.button.parameters.outputVoltage='5';assert.throws(()=>generateFirmware(m.project,catalog),/OUT/);
 const nano=buttonInputProject({boardId:BUTTON_BOARDS.at(-1)});nano.button.parameters.pull='down';assert.ok(validateAssembly(nano.project,catalog).some(i=>i.code==='button-pull'));
});

test('input-only ESP32 pins work with external or onboard pulls and reject internal pulls',()=>{
 for(const module of [false,true]){
  const f=buttonInputProject({boardId:BUTTON_BOARDS[0],module,pull:module?'module':'external-up',inputGpio:34});
  assert.deepEqual(errors(f.project),[]);generateFirmware(f.project,catalog);
  f.button.parameters.pull='up';assert.match(connectionProblem(f.project,catalog,f.button.id,'signal',f.input.id),/подтяж/);
 }
});

test('compatible old buttons retain their stored version, parameters and wiring next to new buttons',()=>{
 const f=buttonInputProject(),old=f.button;old.moduleVersion='1.0.0';f.project.moduleVersions[old.moduleId]='1.0.0';
 const before=structuredClone(f.project);assert.deepEqual(openProject(serializeProject(before),catalog),{project:before,upgraded:false});generateFirmware(before,catalog);
 const mixed=addHardware(before,definition('clex.hardware.button'),catalog);assert.equal(mixed.components.at(-1).moduleVersion,'1.1.0');
 assert.deepEqual(mixed.components.find(c=>c.id===old.id),before.components[0]);assert.deepEqual(mixed.assembly.connections,before.assembly.connections);
 assert.equal(mixed.moduleVersions[old.moduleId],'1.1.0');assert.deepEqual(parseProject(serializeProject(mixed)),mixed);
 const restored=removeHardware(mixed,catalog,mixed.components.at(-1).id);assert.equal(restored.moduleVersions[old.moduleId],'1.0.0');assert.deepEqual(errors(restored),[]);
});

test('an explicit series resistor resolves LED GPIO without a runtime and rejects bypasses or unsafe current',()=>{
 const f=buttonInputProject();let p=disconnectTerminal(f.project,catalog,f.led.id,'anode');
 p=addHardware(p,definition('clex.hardware.resistor'),catalog);const resistor=p.components.at(-1);resistor.parameters.resistanceOhms=330;
 p=connectTerminal(p,catalog,resistor.id,'a',componentContact(f.led.id,'anode'));
 p=connectTerminal(p,catalog,resistor.id,'b',f.output.id);
 assert.equal(ledResistance(f.led,p,catalog),330);assert.deepEqual(errors(p),[]);
 assert.equal(p.gpioAssignments.find(a=>a.componentId===f.led.id).gpio,f.output.gpio);
 assert.deepEqual(parseProject(serializeProject(p)),p);assert.deepEqual(gpioAssignments(p,catalog),p.gpioAssignments);
 const b=generateFirmware(p,catalog);assert.match(b.mainC,new RegExp('gpio_set_level\\('+f.output.gpio+','));assert.doesNotMatch(b.mainC,/resistanceOhms|resistor/);
 assert.match(connectionProblem(p,catalog,f.button.id,'signal',f.output.id),/другого/);
 const bypass=connectTerminal(p,catalog,f.led.id,'anode',f.output.id);assert.ok(validateAssembly(bypass,catalog).some(i=>i.code==='resistor-bypassed'));assert.throws(()=>generateFirmware(bypass,catalog));
 const unsafe=updateHardware(p,catalog,resistor.id,{parameters:{resistanceOhms:10}});assert.ok(validateAssembly(unsafe,catalog).some(i=>i.code==='led-current'));
});

test('changing pull direction preserves wires, marks a wrong common rail and renders the corrected rail as power',()=>{
 const f=buttonInputProject();let p=updateHardware(f.project,catalog,f.button.id,{parameters:{...f.button.parameters,pull:'down'}});
 assert.deepEqual(p.assembly.connections,f.project.assembly.connections);assert.throws(()=>generateFirmware(p,catalog));
 p=connectTerminal(p,catalog,f.button.id,'ground',f.power.id);assert.deepEqual(errors(p),[]);
 const wire=p.assembly.connections.find(w=>w.componentId===f.button.id&&w.terminalId==='ground');assert.equal(wireColors(p,catalog)[wire.id],POWER_COLOR);
});

test('module power is required by the existing input binding and malformed passive GPIO references cannot be saved',()=>{
 const f=buttonInputProject({module:true,pull:'module'});
 const missingPower=disconnectTerminal(f.project,catalog,f.button.id,'power');
 assert.match(hardwareBinding(f.edge,missingPower,catalog).error,/питание/);
 assert.throws(()=>generateFirmware(missingPower,catalog));
 const invalid=structuredClone(f.project);invalid.gpioAssignments[0].pinId='';
 assert.throws(()=>serializeProject(invalid),/назначение GPIO/);
});

test('a resistor branch is not mistaken for a series LED current limiter',()=>{
 const f=buttonInputProject();f.led.parameters.resistorOhms=220;
 let p=addHardware(f.project,definition('clex.hardware.resistor'),catalog);const r=p.components.at(-1);
 p=connectTerminal(p,catalog,r.id,'a',componentContact(f.led.id,'anode'));
 p=connectTerminal(p,catalog,r.id,'b',f.power.id);
 assert.equal(ledResistance(f.led,p,catalog),220);
});
