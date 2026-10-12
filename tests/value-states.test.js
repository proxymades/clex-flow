import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {networkProject} from './network-fixture.js';
import {valueStates,applyValueStates,stateSources} from '../src/logic/valueStates.js';
import {newIndicator,indicatorIssues} from '../src/displays/indicator.js';
import {saveScreen} from '../src/displays/model.js';
import {planDisplayBinding} from '../src/logic/displayBindings.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {createHistory} from '../src/logic/history.js';
import {generateFirmware} from '../src/firmware/generator.js';
const statePort=id=>catalog.modules.find(m=>m.id===id).outputs.find(p=>p.id==='state');
test('Ethernet and resource state metadata match the four actual runtime codes',()=>{
 assert.deepEqual(valueStates(statePort('clex.logic.ethernet')).options.map(o=>o.value),[0,1,2,3]);
 assert.deepEqual(valueStates(statePort('clex.logic.internet-check')).options.map(o=>o.label),['Ожидание сети','Проверка','Ресурс доступен','Ресурс недоступен']);
 const p=networkProject();assert.equal(stateSources(p,catalog).length,2);assert.equal(valueStates(catalog.modules.find(m=>m.id==='clex.logic.counter').outputs[1]),null);
});
test('factory indicator gets source labels, correct codes and source colors without changing geometry or ID',()=>{
 const display=catalog.modules.find(m=>m.display).display,before=newIndicator(display),port=statePort('clex.logic.ethernet'),after=applyValueStates(before,port);
 assert.equal(after.id,before.id);assert.equal(after.x,before.x);assert.equal(after.fontId,before.fontId);assert.equal(after.mode,'dynamic');assert.deepEqual(after.states.map(s=>s.text),port.valueStates.options.map(o=>o.label));assert.deepEqual(after.states.map(s=>s.value),[0,1,2,3]);assert.deepEqual(after.states.map(s=>s.dotColor),port.valueStates.options.map(o=>o.dotColor));assert.deepEqual(indicatorIssues(after),[]);assert.equal(before.states.length,2);
});
test('custom captions, colors, empty text, existing IDs and extra states survive template application',()=>{
 const p=networkProject(),element=Object.values(p.screens)[0].elements.find(e=>e.name==='Ethernet');element.states[0].text='';element.states[0].background='#224466';element.states[0].dotColor='#abcdef';element.states.push({...element.states[0],id:crypto.randomUUID(),value:99,name:'Свое состояние',text:'Свое'});
 const before=structuredClone(element),after=applyValueStates(element,statePort('clex.logic.ethernet'));assert.deepEqual(after.states.find(s=>s.value===0),before.states[0]);assert.deepEqual(after.states.find(s=>s.value===99),before.states.at(-1));assert.deepEqual(element,before);
});
test('generic state metadata supports boolean and text domains, rejects duplicates and incorrect types',()=>{
 for(const [type,values]of [['boolean',[false,true]],['text',['offline','online']]]){const port={type,valueStates:{options:values.map((value,i)=>({value,label:'Состояние '+i,dotColor:'#123456'}))}};assert.ok(valueStates(port));const element=newIndicator(catalog.modules.find(m=>m.display).display),after=applyValueStates(element,port);assert.equal(after.valueType,type);assert.deepEqual(after.states.map(s=>s.value),values);assert.deepEqual(indicatorIssues(after),[]);}
 assert.equal(valueStates({type:'number',valueStates:{options:[{value:'0',label:'Ноль',dotColor:'#123456'}]}}),null);assert.equal(valueStates({type:'number',valueStates:{options:[{value:0,label:'А',dotColor:'#123456'},{value:0,label:'Б',dotColor:'#123456'}]}}),null);
});
test('source preset and binding persist together and generated firmware includes the source captions',()=>{
 const p=networkProject(),view=p.logic.nodes.find(n=>n.moduleId==='clex.logic.display'),eth=p.logic.nodes.find(n=>n.moduleId==='clex.logic.ethernet'),screen=p.screens[view.parameters.componentId],element=screen.elements.find(e=>e.name==='Ethernet');screen.elements=screen.elements.map(e=>e.id===element.id?{...newIndicator(catalog.modules.find(m=>m.display).display),id:element.id,mode:'dynamic',x:e.x,y:e.y,width:e.width}:e);
 const next=saveScreen(p,view.parameters.componentId,{...screen,elements:screen.elements.map(e=>e.id===element.id?applyValueStates(e,statePort('clex.logic.ethernet')):e)});next.logic=planDisplayBinding(next,catalog,{displayNodeId:view.id,bindingId:element.id,sourceNodeId:eth.id,sourcePortId:'state',eventId:'changed'}).graph;assert.deepEqual(parseProject(serializeProject(next)),next);assert.ok(generateFirmware(next,catalog).mainC.includes('clex_indicator_state_t'));
});
test('existing history supports atomic screen snapshots and still leaves viewport out of Undo',()=>{
 const base={nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},_screens:{screen:{name:'До'}}},history=createHistory(base,80,['_screens']);history.change({...base,_screens:{screen:{name:'После'}}});assert.equal(history.canUndo,true);history.change({...history.current,viewport:{x:50,y:0,zoom:1}},{track:false});assert.equal(history.undo()._screens.screen.name,'До');assert.equal(history.current.viewport.x,50);assert.equal(history.redo()._screens.screen.name,'После');
});
