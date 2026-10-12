import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,timer} from './catalog-fixture.js';
import {dynamicDisplayProject} from './dynamic-display-fixture.js';
import {networkProject} from './network-fixture.js';
import {presentPort,visiblePorts,friendlyConnectionProblem} from '../src/logic/presentation.js';
import {displaySources,planDisplayBinding,connectDisplayData} from '../src/logic/displayBindings.js';
import {connectNodes,validateGraph,withLogic} from '../src/logic/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
const view=p=>p.logic.nodes.find(n=>n.moduleId==='clex.logic.display');
const count=p=>p.logic.nodes.find(n=>n.moduleId==='clex.logic.counter');
const screen=p=>p.screens[view(p).parameters.componentId];
function counterChoice(p){return {displayNodeId:view(p).id,bindingId:screen(p).elements[1].id,sourceNodeId:count(p).id,sourcePortId:'value',eventId:'done'};}
function probeChoice(p,eventId='done'){return {displayNodeId:view(p).id,bindingId:screen(p).elements.find(e=>e.name==='Интернет').id,sourceNodeId:p.logic.nodes.find(n=>n.moduleId==='clex.logic.internet-check').id,sourcePortId:'state',eventId};}
test('counter step labels match signed and zero steps without changing IDs or project data',()=>{
 const p=dynamicDisplayProject(),node=count(p),port=catalog.modules.find(m=>m.id===node.moduleId).inputs[0];
 for(const [step,name] of [[1,'Прибавить 1'],[5,'Прибавить 5'],[-2,'Вычесть 2'],[0,'Применить шаг 0']]){node.parameters.step=step;const before=serializeProject(p),shown=presentPort(port,node,p,catalog);assert.equal(shown.name,name);assert.equal(shown.id,'increment');assert.equal(shown.type,'event');assert.equal(serializeProject(p),before);}
});
test('connected additional ports stay visible after serialization and collapsed display',()=>{
 let p=dynamicDisplayProject();assert.equal(visiblePorts(count(p),p,catalog).inputs.find(p=>p.id==='reset').hidden,true);
 const clock=p.logic.nodes.find(n=>n.moduleId===timer.id);p=withLogic(p,connectNodes(p.logic,catalog,{source:clock.id,sourceHandle:'tick',target:count(p).id,targetHandle:'reset'},p));
 p=parseProject(serializeProject(p));assert.equal(visiblePorts(count(p),p,catalog).inputs.find(p=>p.id==='reset').hidden,false);
});
test('compatible hidden outputs reveal during connection; wrong types have a plain reason',()=>{
 const p=dynamicDisplayProject(),clock=p.logic.nodes.find(n=>n.moduleId===timer.id),binding=screen(p).elements[1];
 p.logic.edges=p.logic.edges.filter(edge=>edge.targetHandle!==binding.id);
 const ports=visiblePorts(clock,p,catalog,{connection:{nodeId:view(p).id,portId:binding.id,direction:'input'}});
 assert.equal(ports.outputs.find(port=>port.id==='interval').compatible,true);assert.equal(ports.outputs.find(port=>port.id==='interval').hidden,false);
 assert.match(friendlyConnectionProblem(p,catalog,{source:clock.id,sourceHandle:'tick',target:view(p).id,targetHandle:binding.id}),/принимает число.*передает сигнал/);
});
test('counter helper creates value and ready event together and is idempotent',()=>{
 const p=dynamicDisplayProject();p.logic.edges=p.logic.edges.filter(edge=>edge.target!==view(p).id);
 const plan=planDisplayBinding(p,catalog,counterChoice(p));assert.equal(plan.added.length,2);assert.equal(plan.replaced.length,0);
 const ready=withLogic(p,plan.graph);assert.deepEqual(validateGraph(ready,catalog).filter(i=>i.severity==='error'),[]);assert.deepEqual(parseProject(serializeProject(ready)),ready);
 assert.equal(planDisplayBinding(ready,catalog,counterChoice(ready)).added.length,0);generateFirmware(ready,catalog);
});
test('helper reuses a matching manual common event and preserves other bindings',()=>{
 const p=dynamicDisplayProject(),before=structuredClone(p.logic.edges);assert.equal(planDisplayBinding(p,catalog,counterChoice(p)).added.length,0);assert.deepEqual(p.logic.edges,before);
 const chosen=displaySources(p,catalog,view(p).id,screen(p).elements[1].id);assert.ok(chosen.some(source=>source.port.id==='value'));assert.ok(chosen.every(source=>source.port.type==='number'));
});
test('completion-only network helper also connects immediate IP-loss reset',()=>{
 const p=networkProject(),before=structuredClone(p.logic.edges),plan=planDisplayBinding(p,catalog,probeChoice(p));
 assert.equal(plan.replaced.length,1);assert.equal(plan.added.length,2);assert.ok(plan.graph.edges.some(e=>e.sourceHandle==='done'&&e.targetHandle.startsWith('update.')));assert.ok(plan.graph.edges.some(e=>e.sourceHandle==='ipChanged'&&e.targetHandle==='trigger'));
 assert.deepEqual(p.logic.edges,before);const ready=withLogic(p,plan.graph);assert.deepEqual(validateGraph(ready,catalog).filter(i=>i.severity==='error'),[]);generateFirmware(ready,catalog);
});
test('network reset block is added only when needed and existing manual events are protected',()=>{
 const p=networkProject(),eth=p.logic.nodes.find(n=>n.moduleId==='clex.logic.ethernet');
 p.logic.nodes=p.logic.nodes.filter(n=>n.id!==eth.id);p.logic.edges=p.logic.edges.filter(e=>e.source!==eth.id);screen(p).elements=screen(p).elements.filter(e=>!['Ethernet','IP-адрес'].includes(e.name));
 const plan=planDisplayBinding(p,catalog,probeChoice(p));assert.equal(plan.addedNodes.length,1);const ready=withLogic(p,plan.graph);assert.deepEqual(validateGraph(ready,catalog).filter(i=>i.severity==='error'),[]);generateFirmware(ready,catalog);
 const busy=networkProject(),network=busy.logic.nodes.find(n=>n.moduleId==='clex.logic.ethernet');busy.logic=connectNodes(busy.logic,catalog,{source:network.id,sourceHandle:'connected',target:view(busy).id,targetHandle:'trigger'},busy);
 assert.throws(()=>planDisplayBinding(busy,catalog,probeChoice(busy)),/Общий вход/);assert.doesNotThrow(()=>planDisplayBinding(busy,catalog,probeChoice(busy,'changed')));
});
test('hardware-specific port meanings come from equipment metadata with a generic GPIO fallback',()=>{
 const p=networkProject(),module=catalog.modules.find(m=>m.id==='clex.logic.gpio-read'),node={id:'read',moduleId:module.id,parameters:{componentId:'button'}};
 p.components.push({id:'button',moduleId:'clex.hardware.button'});const port=presentPort(module.outputs[1],node,p,catalog);assert.equal(port.name,'Кнопка отпущена?');assert.match(port.description,/Нет, если нажата/);
 const generic={...catalog,modules:catalog.modules.map(m=>{const copy={...m};if(m.id==='clex.hardware.button')delete copy.logicPresentation;return copy;})};assert.equal(presentPort(module.outputs[1],node,p,generic).name,'Высокий уровень?');
});
test('UI names and extra metadata do not change generated firmware',()=>{
 const p=networkProject(),plain={...catalog,modules:catalog.modules.map(m=>({...m,inputs:m.inputs.map(port=>({...port,name:'legacy'})),outputs:m.outputs.map(port=>({...port,name:'legacy'}))}))};
 assert.equal(generateFirmware(p,catalog).mainC,generateFirmware(p,plain).mainC);
});

test('one Ethernet IP connection creates its update and persists without changing other bindings',()=>{
 const p=networkProject(),display=view(p),eth=p.logic.nodes.find(n=>n.moduleId==='clex.logic.ethernet'),ip=screen(p).elements.find(e=>e.name==='IP-адрес');
 p.logic.edges=p.logic.edges.filter(e=>e.targetHandle!==ip.id&&e.targetHandle!=='update.'+ip.id);
 const before=structuredClone(p),graph=connectDisplayData(p,catalog,{source:eth.id,sourceHandle:'ip',target:display.id,targetHandle:ip.id}),ready=withLogic(p,graph);
 assert.equal(graph.edges.length,p.logic.edges.length+2);assert.ok(graph.edges.some(e=>e.sourceHandle==='changed'&&e.targetHandle==='update.'+ip.id));
 for(const edge of p.logic.edges)assert.deepEqual(graph.edges.find(e=>e.id===edge.id),edge);
 assert.deepEqual(validateGraph(ready,catalog).filter(i=>i.severity==='error'),[]);assert.deepEqual(parseProject(serializeProject(ready)),ready);assert.deepEqual(p,before);generateFirmware(ready,catalog);
});
test('automatic counter updates leave valid manual common updates intact',()=>{
 const p=dynamicDisplayProject(),display=view(p),counter=count(p),binding=screen(p).elements[1];
 const manual=p.logic.edges.find(e=>e.targetHandle==='trigger');p.logic.edges=p.logic.edges.filter(e=>e.targetHandle!==binding.id);
 const preserved=connectDisplayData(p,catalog,{source:counter.id,sourceHandle:'value',target:display.id,targetHandle:binding.id});assert.equal(preserved.edges.length,p.logic.edges.length+1);assert.deepEqual(preserved.edges.find(e=>e.id===manual.id),manual);
 p.logic.edges=p.logic.edges.filter(e=>e.target!==display.id);const graph=connectDisplayData(p,catalog,{source:counter.id,sourceHandle:'value',target:display.id,targetHandle:binding.id});assert.ok(graph.edges.some(e=>e.sourceHandle==='done'&&e.targetHandle==='update.'+binding.id));assert.deepEqual(validateGraph(withLogic(p,graph),catalog).filter(i=>i.severity==='error'),[]);generateFirmware(withLogic(p,graph),catalog);
});
test('existing completion-only probe timing and reset survive reconnecting its data',()=>{
 const p=networkProject();p.logic=planDisplayBinding(p,catalog,probeChoice(p)).graph;const choice=probeChoice(p),before=structuredClone(p.logic.edges.filter(e=>e.dataType==='event'));
 p.logic.edges=p.logic.edges.filter(e=>e.targetHandle!==choice.bindingId);
 const graph=connectDisplayData(p,catalog,{source:choice.sourceNodeId,sourceHandle:choice.sourcePortId,target:choice.displayNodeId,targetHandle:choice.bindingId});assert.deepEqual(graph.edges.filter(e=>e.dataType==='event'),before);assert.deepEqual(validateGraph(withLogic(p,graph),catalog).filter(i=>i.severity==='error'),[]);
});
test('incompatible manual timing is explained without replacing it or mutating the project',()=>{
 const p=dynamicDisplayProject(),clock=p.logic.nodes.find(n=>n.moduleId===timer.id),binding=screen(p).elements[1];p.logic.edges=p.logic.edges.filter(e=>e.target!==view(p).id);
 p.logic=connectNodes(p.logic,catalog,{source:clock.id,sourceHandle:'tick',target:view(p).id,targetHandle:'update.'+binding.id},p);const before=structuredClone(p);
 assert.throws(()=>connectDisplayData(p,catalog,{source:count(p).id,sourceHandle:'value',target:view(p).id,targetHandle:binding.id}),/настроено вручную/);assert.deepEqual(p,before);
});
