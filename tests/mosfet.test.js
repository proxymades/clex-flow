import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {catalog} from './catalog-fixture.js';
import {MOSFET_BOARDS,mosfetProject} from './mosfet-fixture.js';
import {firmwareProject} from './firmware-fixture.js';
import {moduleFor,updateHardware,validateAssembly,connectionProblem,disconnectTerminal} from '../src/assembly/model.js';
import {terminalLayout} from '../src/assembly/terminalLayout.js';
import {assemblyRoutingScene} from '../src/assembly/routingScene.js';
import {contactInfo} from '../src/assembly/endpoints.js';
import {hardwareBinding,validateGraph,logicAdditionProblem,updateNode,nodePorts,withLogic} from '../src/logic/model.js';
import {nodeDisplayName} from '../src/logic/presentation.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
const errors=p=>[...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(issue=>issue.severity==='error');
test('MOSFET channel count resolves consistently in assembly, contacts and routing',()=>{
 for(let count=1;count<=16;count++){
  const {project,component}=mosfetProject({channels:String(count),connected:[1]});
  const module=moduleFor(component,catalog),layout=terminalLayout(module);
  assert.equal(module.terminals.length,count+1);
  assert.equal(contactInfo(project,catalog,component.id,'in'+count).terminal.channel,count);
  assert.equal(contactInfo(project,catalog,component.id,'in'+(count+1)).terminal,undefined);
  assert.ok(layout.terminals.every(t=>t.x>=0&&t.x<=layout.width&&t.y>=0&&t.y<=layout.height));
  const scene=assemblyRoutingScene({...project.assembly,components:project.components},catalog.boards.find(b=>b.id===project.boardId),catalog);
  assert.equal(scene.nodes.find(n=>n.id===component.id).height,layout.height);
  assert.ok(scene.edges.every(e=>e.data.sourcePin&&e.data.targetTerminal));
  assert.deepEqual(errors(project),[]);
 }
});
test('MOSFET logic supports every concrete board and preserves project serialization',()=>{
 for(const boardId of MOSFET_BOARDS)for(const activeLevel of ['high','low']){
  const {project,component,blocks}=mosfetProject({boardId,activeLevel});
  assert.deepEqual(errors(project),[],boardId);
  assert.deepEqual(parseProject(serializeProject(project)),project);
  for(const {node,channel} of blocks){
   assert.equal(logicAdditionProblem(catalog.modules.find(m=>m.id===node.moduleId),project,catalog),null);
   const binding=hardwareBinding(node,project,catalog);
   assert.equal(binding.error,null);assert.equal(binding.gpio,project.gpioAssignments.find(a=>a.terminalId==='in'+channel).gpio);
   assert.match(nodeDisplayName(node,project,catalog),/Управлять MOSFET-ключом/);
  }
  const code=generateFirmware(project,catalog).mainC;
  const pin=project.gpioAssignments.find(a=>a.terminalId==='in1').gpio,avr=catalog.boards.find(b=>b.id===boardId).platform==='arduino-avr';
  const preload=avr?`digitalWrite(${pin}, ${activeLevel==='low'?'HIGH':'LOW'});`:`gpio_set_level(${pin}, ${activeLevel==='low'?1:0})`;
  const enable=avr?`pinMode(${pin}, OUTPUT)`:`.pin_bit_mask = 1ULL << ${pin}`;
  assert.ok(code.indexOf(preload)>=0&&code.indexOf(preload)<code.indexOf(enable));
  assert.equal(component.parameters.activeLevel,activeLevel);
 }
});
test('MOSFET unused channel count is visual; reducing channels removes only obsolete wires',async()=>{
 const {project,component}=mosfetProject({channels:'8',connected:[1,8]});
 const before=generateFirmware(project,catalog),larger=updateHardware(project,catalog,component.id,{parameters:{...component.parameters,channels:'16'}});
 assert.equal(await firmwareFingerprint(generateFirmware(larger,catalog)),await firmwareFingerprint(before));
 const changed=updateHardware(project,catalog,component.id,{parameters:{...component.parameters,activeLevel:'low'}});
 assert.notEqual(await firmwareFingerprint(generateFirmware(changed,catalog)),await firmwareFingerprint(before));
 project.assembly.portSides={[component.id]:{in1:'left',in8:'right'}};
 const reduced=updateHardware(project,catalog,component.id,{parameters:{...component.parameters,channels:'2'}});
 assert.ok(reduced.assembly.connections.some(w=>w.terminalId==='in1'));
 assert.ok(!reduced.assembly.connections.some(w=>w.terminalId==='in8'));
 assert.deepEqual(reduced.assembly.portSides[component.id],{in1:'left'});
 assert.ok(!reduced.gpioAssignments.some(a=>a.terminalId==='in8'));
 assert.throws(()=>generateFirmware(reduced,catalog),/существующий канал/);
});
test('MOSFET rejects missing wiring, duplicate GPIO, invalid channels and parameters',()=>{
 const {project,component,blocks}=mosfetProject(),board=catalog.boards.find(b=>b.id===project.boardId);
 for(const terminal of ['ground','in1'])assert.throws(()=>generateFirmware(disconnectTerminal(project,catalog,component.id,terminal),catalog));
 assert.ok(connectionProblem(project,catalog,component.id,'in2',project.gpioAssignments[0].pinId));
 assert.ok(connectionProblem(project,catalog,component.id,'in1',board.pins.find(p=>p.kind==='power').id));
 blocks[0].node.parameters.channel='3';assert.ok(hardwareBinding(blocks[0].node,project,catalog).error);
 blocks[0].node.parameters.channel='1';component.parameters.activeLevel='invalid';assert.ok(errors(project).length);
});
test('existing LED projects need no channel parameter and keep identical firmware',()=>{
 const project=firmwareProject(),before=generateFirmware(project,catalog);
 for(const node of project.logic.nodes)delete node.parameters.channel;
 assert.deepEqual(errors(project),[]);assert.equal(generateFirmware(project,catalog).mainC,before.mainC);
});
test('selecting a multichannel output initializes the channel selection',()=>{
 const {project,component}=mosfetProject(),node=project.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-set');
 node.moduleId='clex.logic.gpio-set';
 delete node.parameters.channel;
 const graph=updateNode(project.logic,node.id,{parameters:{...node.parameters,componentId:component.id}},catalog,project);
 assert.equal(graph.nodes.find(n=>n.id===node.id).parameters.channel,'1');
 assert.equal(hardwareBinding(graph.nodes.find(n=>n.id===node.id),{...project,logic:graph},catalog).error,null);
});
test('channel selection preserves all three independent command inputs and their connections',()=>{
 const {project,blocks}=mosfetProject(),node=blocks[0].node;
 const graph=updateNode(project.logic,node.id,{parameters:{...node.parameters,channel:'2'}},catalog,project);
 assert.deepEqual(graph.edges,project.logic.edges);
 assert.deepEqual(nodePorts(node,catalog,project).inputs.map(p=>p.id),['on','off','toggle']);
 assert.deepEqual(errors({...project,logic:graph}),[]);
});
test('generated MOSFET firmware executes independent channels and shared state for HIGH and LOW',()=>{
 const root=mkdtempSync(join(tmpdir(),'clex-mosfet-'));
 try{
  mkdirSync(join(root,'avr'));
  writeFileSync(join(root,'Arduino.h'),`#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <assert.h>
#define LOW 0
#define HIGH 1
#define OUTPUT 1
static bool levels[64],enabled[64];
static int inactive;
static uint32_t millis(){return 0;}
static void digitalWrite(int pin,int level){levels[pin]=level;}
static void pinMode(int pin,int mode){assert(mode==OUTPUT);assert(levels[pin]==inactive);enabled[pin]=true;}
struct SerialStub{void begin(int){}}; static SerialStub Serial;
`);
  writeFileSync(join(root,'avr/pgmspace.h'),'#pragma once\n#define PSTR(x) (x)\n');
  for(const activeLevel of ['high','low']){
   const {project,blocks}=mosfetProject({boardId:'arduino-nano-atmega328p-ch340',activeLevel});
   const duplicate={...structuredClone(blocks[0].node),id:'shared-channel',name:'Shared channel'};project.logic.nodes.push(duplicate);
   const clock=project.logic.nodes.find(n=>n.moduleId==='clex.logic.timer');project.logic.edges.push({id:'shared-command',source:clock.id,sourceHandle:'tick',target:duplicate.id,targetHandle:'on',dataType:'event'});
   const nodes=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),pin=c=>project.gpioAssignments.find(a=>a.terminalId==='in'+c).gpio;
   const call=(channel,action)=>'node_'+nodes.findIndex(n=>n.id===blocks.find(b=>b.channel===channel).node.id)+'_'+action+'();';
   const shared='node_'+nodes.findIndex(n=>n.id===duplicate.id)+'_on();';
   const active=activeLevel==='high'?1:0,off=1-active;
   const check=(a,b)=>`assert(levels[${pin(1)}]==${a?active:off});assert(levels[${pin(2)}]==${b?active:off});`;
   const sourceCode=generateFirmware(withLogic(project,project.logic),catalog).mainC+`\nint main(){inactive=${off};setup();assert(enabled[${pin(1)}]&&enabled[${pin(2)}]);${check(false,false)}${call(1,'on')}${check(true,false)}${call(1,'toggle')}${check(false,false)}${call(2,'on')}${check(false,true)}${shared}${check(true,true)}${call(1,'toggle')}${check(false,true)}${call(2,'off')}${check(false,false)}${call(2,'toggle')}${check(false,true)}${call(2,'toggle')}${check(false,false)}return 0;}\n`;
   const file=join(root,activeLevel+'.cpp'),binary=join(root,activeLevel);writeFileSync(file,sourceCode);
   const build=spawnSync(process.env.CXX||'c++',['-std=c++17','-I',root,file,'-o',binary],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
   const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
