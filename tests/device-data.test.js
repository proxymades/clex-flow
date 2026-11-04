import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {firmwareProject} from './firmware-fixture.js';
import {numericProject} from './numeric-fixture.js';
import {conditionProject} from './condition-fixture.js';
import {nanoProject} from './nano-fixture.js';
import {networkProject} from './network-fixture.js';
import {temperatureProject} from './temperature-fixture.js';
import {xgzpProject} from './xgzp-fixture.js';
import {stepperProject} from './stepper-fixture.js';
import {routerProject} from './router-fixture.js';
import {mqttProject} from './mqtt-fixture.js';
import {espNowProject} from './espnow-fixture.js';
import {audioPlayProject} from './audio-play-fixture.js';
import {peripheralProject} from './peripheral-fixture.js';
import {addNode,connectNodes,nodePorts,validateGraph,withLogic} from '../src/logic/model.js';
import {newCondition} from '../src/logic/conditions.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {openProject} from '../src/projects/upgrade.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {applyValueStates} from '../src/logic/valueStates.js';

test('all restored Boolean device outputs can feed a condition and survive saving',()=>{
 const factories=[()=>firmwareProject(true),()=>numericProject().project,()=>conditionProject().project,()=>nanoProject({watch:true}),networkProject,temperatureProject,()=>xgzpProject().project,()=>stepperProject().project,()=>routerProject().project,()=>mqttProject().project,()=>espNowProject({combined:true,peerHealth:true}).project,()=>audioPlayProject(),()=>peripheralProject()];
 const checked=new Set();
 for(const factory of factories){
  const base=factory();
  for(const source of base.logic.nodes)for(const port of nodePorts(source,catalog,base).outputs.filter(p=>p.type==='boolean')){
   let project=structuredClone(base);
   for(const id of ['clex.logic.compare-number','clex.logic.serial'])project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id===id),project.components,project,catalog));
   const condition=project.logic.nodes.at(-2),sink=project.logic.nodes.at(-1);
   condition.parameters.conditions=JSON.stringify([newCondition()]);
   const events=nodePorts(source,catalog,base).outputs.filter(p=>p.type==='event'),event=events.find(p=>p.id===port.readyOn)||events[0];assert.ok(event,source.moduleId);
   for(const [from,sh,to,th]of [[source.id,port.id,condition.id,'c1.value'],[source.id,event.id,condition.id,'trigger'],[condition.id,'matched',sink.id,'trigger']])project=withLogic(project,connectNodes(project.logic,catalog,{source:from,sourceHandle:sh,target:to,targetHandle:th},project));
   assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[],source.moduleId+'/'+port.id);
   assert.deepEqual(parseProject(serializeProject(project)),project);
   generateFirmware(project,catalog);checked.add(source.moduleId+'/'+port.id);
  }
 }
 for(const key of ['clex.logic.compare-number/result','clex.logic.mqtt-receive/retain','clex.logic.stepper/moving','clex.logic.stepper/enabled','clex.logic.stopwatch/running','clex.logic.espnow-control/rssiValid','clex.logic.espnow-control/statisticsValid','clex.logic.router/running','clex.logic.internet-check/isAvailable','clex.logic.gpio-set/state','clex.logic.gpio-read/level','clex.logic.temperature/valid','clex.logic.xgzp6847d/valid'])assert.ok(checked.has(key),key);
});

test('Boolean indicators and text use preserved source values and explicit text conversion',()=>{
 let project=networkProject();
 const source=project.logic.nodes.find(n=>n.moduleId==='clex.logic.ethernet'),view=project.logic.nodes.find(n=>n.moduleId==='clex.logic.display'),screen=project.screens[view.parameters.componentId];
 const indicator=screen.elements.find(e=>e.type==='indicator');
 Object.assign(indicator,applyValueStates(indicator,{type:'boolean'}));
 project.logic.edges=project.logic.edges.filter(e=>e.target!==view.id||e.targetHandle!==indicator.id);
 project=withLogic(project,connectNodes(project.logic,catalog,{source:source.id,sourceHandle:'hasIp',target:view.id,targetHandle:indicator.id},project));
 assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[]);
 assert.match(generateFirmware(project,catalog).mainC,/has_ip\) \? "true" : "false"/);
 const text=screen.elements.find(e=>e.type==='text'&&e.mode==='dynamic');
 text.valueType='boolean';text.initialValue=false;
 project.logic.edges=project.logic.edges.filter(e=>e.target!==view.id||e.targetHandle!==text.id);
 project=withLogic(project,connectNodes(project.logic,catalog,{source:source.id,sourceHandle:'hasIp',target:view.id,targetHandle:text.id},project));
 assert.doesNotThrow(()=>generateFirmware(project,catalog));assert.deepEqual(parseProject(serializeProject(project)),project);
});

test('old resource availability data is distinguished from the newer availability event',()=>{
 const project=networkProject();project.formatVersion=3;
 const source=project.logic.nodes.find(n=>n.moduleId==='clex.logic.internet-check'),view=project.logic.nodes.find(n=>n.moduleId==='clex.logic.display'),element=project.screens[view.parameters.componentId].elements.find(e=>e.type==='indicator');
 Object.assign(element,applyValueStates(element,{type:'boolean'}));
 project.logic.edges=project.logic.edges.filter(e=>e.target!==view.id||e.targetHandle!==element.id);
 project.logic.edges.push({id:crypto.randomUUID(),source:source.id,sourceHandle:'available',target:view.id,targetHandle:element.id,dataType:'boolean'},{id:crypto.randomUUID(),source:source.id,sourceHandle:'changed',target:view.id,targetHandle:'update.'+element.id,dataType:'event'});
 const converted=openProject(JSON.stringify(project),catalog).project;
 const edge=converted.logic.edges.find(e=>e.targetHandle===element.id);
 assert.equal(edge.sourceHandle,'isAvailable');assert.ok(!edge.legacy);
 generateFirmware(converted,catalog);
});
