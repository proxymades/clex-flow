import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, timer, serial } from './catalog-fixture.js';
import { createProject, parseProject, serializeProject } from '../src/projects/model.js';
import { addNode, connectNodes, withLogic, validateGraph } from '../src/logic/model.js';
import { generateFirmware, firmwareFingerprint } from '../src/firmware/generator.js';
import { connectDisplayData } from '../src/logic/displayBindings.js';
import { displayProject } from './display-fixture.js';
const module=catalog.modules.find(module=>module.id==='clex.logic.stopwatch');
function standalone(boardId='waveshare-esp32-s3-eth'){
 let p=createProject('Stopwatch','',boardId,boardId.includes('-p4-')?{chipRevision:'pre-v3'}:{camera:'disconnected'});
 let graph=addNode(p.logic,module,p.components,p,catalog),watch=graph.nodes.at(-1);
 graph=addNode(graph,serial,p.components,p,catalog);const output=graph.nodes.at(-1);
 for(const [sourceHandle,targetHandle] of [['text','text'],['changed','trigger']])graph=connectNodes(graph,catalog,{source:watch.id,sourceHandle,target:output.id,targetHandle},{...p,logic:graph});
 return withLogic(p,graph);
}
test('stopwatch emits formatted time on both MCU targets without a tick timer',()=>{
 for(const id of ['waveshare-esp32-s3-eth','waveshare-esp32-p4-nano']){
  const p=standalone(id),bundle=generateFirmware(p,catalog);
  assert.deepEqual(validateGraph(p,catalog).filter(x=>x.severity==='error'||x.code==='logic-unreachable'),[]);
  assert.equal(p.logic.nodes.some(n=>n.moduleId===timer.id),false);
  assert.match(bundle.mainC,/stopwatch_\d+\.text/);
  assert.ok(bundle.mainC.indexOf('clex_stopwatch_initialize(&stopwatch_')<bundle.mainC.indexOf('xTaskCreate(flow_worker'));
  assert.deepEqual(parseProject(serializeProject(p)).logic,p.logic);
 }
});
test('stopwatch display binding creates its ordinary update event automatically',()=>{
 let p=displayProject(),graph=addNode(p.logic,module,p.components,p,catalog),watch=graph.nodes.at(-1);
 p=withLogic(p,graph);const view=graph.nodes.find(n=>n.moduleId==='clex.logic.display');
 p.screens[view.parameters.componentId].elements=[{id:'elapsed',name:'Время',type:'text',text:'',mode:'dynamic',valueType:'text',initialValue:'00:00:00',prefix:'',suffix:'',x:8,y:30,fontId:'montserrat_28',color:'#ffffff'}];
 p=withLogic(p,connectDisplayData(p,catalog,{source:watch.id,sourceHandle:'text',target:view.id,targetHandle:'elapsed'}));
 assert.ok(p.logic.edges.some(e=>e.source===watch.id && e.sourceHandle==='changed' && e.targetHandle==='update.elapsed'));
 assert.deepEqual(validateGraph(p,catalog).filter(x=>x.severity==='error'),[]);
 assert.match(generateFirmware(p,catalog).mainC,/clex_graphics_set_text\([^\n]+stopwatch_\d+\.text\)/);
 const limited=structuredClone(catalog),physical=p.components.find(c=>c.id===view.parameters.componentId);
 const font=limited.modules.find(m=>m.id===physical.moduleId).display.graphics.fonts.find(f=>f.id==='montserrat_28');
 font.ranges=[[48,58]];assert.doesNotThrow(()=>generateFirmware(p,limited));
 font.ranges=[[48,57]];assert.throws(()=>generateFirmware(p,limited),/шрифт|символ/i);
});
test('control ports are independent and auto-start invalidates the previous firmware identity',async()=>{
 let p=standalone(),graph=p.logic,watch=graph.nodes.find(n=>n.moduleId===module.id);
 watch.parameters.autoStart=false;
 for(const targetHandle of ['start','pause','reset']){
  graph=addNode(graph,timer,p.components,{...p,logic:graph},catalog);
  graph=connectNodes(graph,catalog,{source:graph.nodes.at(-1).id,sourceHandle:'tick',target:watch.id,targetHandle},{...p,logic:graph});
 }
 p=withLogic(p,graph);const bundle=generateFirmware(p,catalog);
 assert.deepEqual(validateGraph(p,catalog).filter(x=>x.severity==='error'),[]);
 assert.match(bundle.mainC,/node_\d+_pause\(\);/);assert.match(bundle.mainC,/node_\d+_reset\(\);/);
 const changed=structuredClone(p);changed.logic.nodes.find(n=>n.id===watch.id).parameters.autoStart=true;
 assert.notEqual(await firmwareFingerprint(bundle),await firmwareFingerprint(generateFirmware(changed,catalog)));
});
