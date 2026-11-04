import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {firmwareProject} from './firmware-fixture.js';
import {numericProject} from './numeric-fixture.js';
import {touchButtonProject} from './touch-button-fixture.js';
import {networkProject} from './network-fixture.js';
import {createProject,parseProject,serializeProject} from '../src/projects/model.js';
import {openProject} from '../src/projects/upgrade.js';
import {validateGraph,connectNodes,removeElements} from '../src/logic/model.js';
import {visiblePorts} from '../src/logic/presentation.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {loadProjectFiles,readImportedProject} from '../src/projects/projectFiles.js';
import {PROJECT_KEY,BACKUP_PREFIX,browserRecords,backupBrowserProject,saveBrowserProject} from '../src/projects/browserStorage.js';
import {addHardware,connectTerminal,connectionProblem as wireProblem} from '../src/assembly/model.js';

import {oldBlink,ambiguousProject,edge,versions} from './project-upgrade-fixture.js';
const omit = (item,key) => Object.fromEntries(Object.entries(item).filter(([name])=>name!==key));
const open = p => openProject(JSON.stringify(p),catalog).project;
const memoryStorage = entries => {
  const map=new Map(Object.entries(entries||{}));
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),map};
};

test('formats 1 and 2 open, current projects remain unchanged, corrupt and future formats still fail',()=>{
  for(const version of [1,2,3]) {
    const p=createProject('Old');p.formatVersion=version;
    if(version===1){p.boardId='esp32-s3-generic';delete p.boardSettings;p.assembly.positions={};delete p.assembly.viewport;}
    const upgraded=open(p);assert.equal(upgraded.formatVersion,4);assert.deepEqual(parseProject(serializeProject(upgraded)),upgraded);
  }
  const current=firmwareProject();assert.deepEqual(openProject(serializeProject(current),catalog),{project:current,upgraded:false});
  assert.throws(()=>openProject('{broken',catalog),/JSON/);
  assert.throws(()=>open({...current,formatVersion:999}),/Версия формата/);
  assert.throws(()=>open({...current,formatVersion:3,logic:{nodes:null}}),/структура/);
  assert.throws(()=>openProject('я'.repeat(1024*1024+1),catalog),/2 МБ/);
});

test('old toggle retains identity, hardware, wiring and positions; conversion is idempotent',()=>{
  const original=oldBlink(),snapshot=structuredClone(original),p=open(original);
  assert.deepEqual(original,snapshot);
  for(const field of ['id','name','description','createdAt','updatedAt','components','gpioAssignments','assembly','boardId','boardSettings'])assert.deepEqual(p[field],original[field]);
  assert.deepEqual(p.logic.nodes.map(n=>[n.id,n.position]),original.logic.nodes.map(n=>[n.id,n.position]));
  assert.ok(p.logic.edges.some(e=>e.targetHandle==='toggle'));assert.ok(!p.logic.edges.some(e=>e.legacy));
  assert.deepEqual(openProject(serializeProject(p),catalog),{project:p,upgraded:false});
  generateFirmware(p,catalog);
});

test('touch transitions preserve their normalized meaning for both active levels',()=>{
  for(const activeLevel of ['low','high']){
    const {project,nodes}=touchButtonProject(undefined,activeLevel);project.formatVersion=3;
    project.logic.edges=project.logic.edges.filter(e=>e.source!==nodes.edge.id&&e.source!==nodes.read.id);
    project.logic.edges.push(edge(nodes.edge.id,'rising',nodes.counter.id,'increment'),edge(nodes.edge.id,'changed',nodes.read.id,'trigger'),edge(nodes.read.id,'done',nodes.off.id,'trigger'));
    const p=open(project);
    assert.ok(p.logic.edges.some(e=>e.source===nodes.edge.id&&e.target===nodes.counter.id&&e.sourceHandle==='active'));
    assert.deepEqual(p.logic.edges.filter(e=>e.source===nodes.edge.id&&e.target===nodes.read.id).map(e=>e.sourceHandle).sort(),['active','inactive']);
    assert.deepEqual(p.logic.edges.filter(e=>e.source===nodes.read.id).map(e=>e.sourceHandle).sort(),['active','inactive']);
    generateFirmware(p,catalog);
  }
});

test('mechanical button high/low is converted to released/pressed, preserving electrical meaning',()=>{
  const p=firmwareProject(true);p.formatVersion=3;
  const read=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-read'),output=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-set');
  output.parameters.defaultValue=true;
  p.logic.edges=p.logic.edges.filter(e=>e.target!==output.id);
  p.logic.edges.push(edge(read.id,'level',output.id,'value','boolean'),edge(read.id,'done',output.id,'trigger'));
  const converted=open(p);
  assert.ok(converted.logic.edges.some(e=>e.source===read.id&&e.sourceHandle==='inactive'&&e.targetHandle==='on'));
  assert.ok(converted.logic.edges.some(e=>e.source===read.id&&e.sourceHandle==='active'&&e.targetHandle==='off'));
  generateFirmware(converted,catalog);
});

test('Boolean numeric comparison becomes output commands, including the invalid-value branch',()=>{
  for(const mode of ['range','compare']){
    const {project:p,nodes}=numericProject(undefined,{mode});p.formatVersion=3;
    for(const key of ['low','high']){
      const target=nodes[key];target.moduleId='clex.logic.relay';target.parameters.action='set';target.parameters.defaultValue=false;
      p.logic.edges=p.logic.edges.filter(e=>e.target!==target.id);
      p.logic.edges.push(edge(nodes.condition.id,'changed',target.id,'trigger'),edge(nodes.condition.id,mode==='compare'?'result':key==='low'?'isBelow':'isAbove',target.id,'value','boolean'));
    }
    versions(p);const converted=open(p);
    for(const key of ['low','high']){
      const output=converted.logic.nodes.find(n=>n.id===nodes[key].id);
      assert.equal(output.moduleId,'clex.logic.gpio-set');assert.equal(output.parameters.channel,nodes[key].parameters.channel);
      assert.ok(converted.logic.edges.some(e=>e.target===output.id&&e.sourceHandle==='failed'&&e.targetHandle==='off'));
    }
    assert.equal(converted.logic.edges.filter(e=>e.legacy).length,0);generateFirmware(converted,catalog);
  }
});

test('old touch Boolean data retains activation semantics for both electrical active levels',()=>{
  for(const activeLevel of ['low','high']){
    let {project:p,nodes}=touchButtonProject(undefined,activeLevel);p.formatVersion=3;
    p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.led'),catalog);
    const led=p.components.at(-1),board=catalog.boards.find(b=>b.id===p.boardId);
    for(const terminal of ['anode','cathode'])p=connectTerminal(p,catalog,led.id,terminal,board.pins.find(pin=>!wireProblem(p,catalog,led.id,terminal,pin.id)).id);
    nodes.off.moduleId='clex.logic.gpio-set';nodes.off.parameters={componentId:led.id,defaultValue:true};versions(p);
    p.logic.edges=p.logic.edges.filter(e=>e.target!==nodes.off.id);
    p.logic.edges.push(edge(nodes.read.id,'level',nodes.off.id,'value','boolean'),edge(nodes.read.id,'done',nodes.off.id,'trigger'));
    const converted=open(p);
    assert.ok(converted.logic.edges.some(e=>e.source===nodes.read.id&&e.sourceHandle==='active'&&e.target===nodes.off.id&&e.targetHandle==='on'));
    assert.ok(!converted.logic.edges.some(e=>e.legacy));generateFirmware(converted,catalog);
  }
});

test('ambiguous sampled connections survive save/reopen with warnings and visible nonconnectable old ports',()=>{
  const original=ambiguousProject(),p=open(original),pending=p.logic.edges.filter(e=>e.legacy);
  assert.equal(pending.length,2);
  assert.deepEqual(pending.map(edge=>omit(edge,'legacy')),original.logic.edges.filter(e=>pending.some(p=>p.id===e.id)));
  assert.deepEqual(parseProject(serializeProject(p)),p);
  const warnings=validateGraph(p,catalog).filter(i=>i.code==='logic-legacy-connection');
  assert.equal(warnings.length,2);assert.ok(warnings.every(i=>i.severity==='warning'));
  assert.equal(validateGraph(p,catalog).filter(i=>i.severity==='error').length,0);
  assert.throws(()=>generateFirmware(p,catalog),/старые связи/);
  const bool=pending.find(e=>e.dataType==='boolean'),source=p.logic.nodes.find(n=>n.id===bool.source);
  assert.equal(visiblePorts(source,p,catalog).outputs.find(port=>port.id==='level').type,'boolean');
  assert.throws(()=>connectNodes(p.logic,catalog,{source:bool.source,sourceHandle:'level',target:bool.target,targetHandle:'value'},p),/порт отсутствует/);
  p.logic=removeElements(p.logic,[],pending.map(e=>e.id));
  p.logic=connectNodes(p.logic,catalog,{source:bool.source,sourceHandle:'active',target:bool.target,targetHandle:'on'},p);
  generateFirmware(p,catalog);
});

test('old Boolean indicator keeps appearance and its usable source data',()=>{
  const p=networkProject();p.formatVersion=3;
  const view=p.logic.nodes.find(n=>n.moduleId==='clex.logic.display'),eth=p.logic.nodes.find(n=>n.moduleId==='clex.logic.ethernet');
  const element=p.screens[view.parameters.componentId].elements.find(e=>e.type==='indicator');
  element.valueType='boolean';element.initialValue=false;element.states=element.states.slice(0,2).map((s,i)=>({...s,value:Boolean(i)}));element.fallbackStateId=element.states[0].id;
  const oldAppearance=element.states.map(state=>omit(state,'value'));
  const data=p.logic.edges.find(e=>e.targetHandle===element.id);data.sourceHandle='hasIp';data.dataType='boolean';
  const converted=open(p),after=converted.screens[view.parameters.componentId].elements.find(e=>e.id===element.id);
  assert.deepEqual(after.states.map(state=>omit(state,'value')),oldAppearance);assert.equal(after.valueType,'boolean');
  assert.ok(!converted.logic.edges.find(e=>e.id===data.id).legacy);
  assert.equal(visiblePorts(converted.logic.nodes.find(n=>n.id===eth.id),converted,catalog).outputs.find(p=>p.id==='hasIp').type,'boolean');
});

test('old Boolean text retains its displayed initial value',()=>{
  for(const value of [false,true]){
    const p=networkProject();p.formatVersion=3;
    const view=p.logic.nodes.find(n=>n.moduleId==='clex.logic.display');
    const element=p.screens[view.parameters.componentId].elements.find(e=>e.type==='text'&&e.mode==='dynamic');
    element.valueType='boolean';element.initialValue=value;
    p.logic.edges=p.logic.edges.filter(e=>e.targetHandle!==element.id);
    const converted=open(p),after=converted.screens[view.parameters.componentId].elements.find(e=>e.id===element.id);
    assert.equal(after.valueType,'boolean');assert.equal(after.initialValue,value);
  }
});

test('unknown old blocks remain editable and their connected ports remain visible',()=>{
  const p=oldBlink(),output=p.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-toggle');
  output.moduleId='clex.logic.obsolete';versions(p);
  const converted=open(p),node=converted.logic.nodes.find(n=>n.id===output.id);
  assert.equal(node.moduleId,output.moduleId);assert.ok(node.legacy);
  assert.ok(visiblePorts(node,converted,catalog).inputs.some(p=>p.id==='trigger'&&p.legacy));
  assert.deepEqual(parseProject(serializeProject(converted)),converted);
});

test('library upgrade failure leaves the project open; mixed invalid files do not hide valid projects',async()=>{
  const original=JSON.stringify(oldBlink()),id=JSON.parse(original).id;let calls=0;
  const result=await loadProjectFiles([{id,contents:original},{id:'bad',contents:'broken'}],catalog,async()=>{calls++;throw Error('Нет места');});
  assert.equal(calls,1);assert.equal(result.projects.length,1);assert.equal(result.errors.length,1);assert.match(result.notices[0],/открыт.*не записан/);
  const mismatch=await loadProjectFiles([{id:crypto.randomUUID(),contents:original}],catalog,async()=>assert.fail('must not write'));
  assert.equal(mismatch.projects.length,0);
});

test('import backs up exact original bytes and never writes an external source',async()=>{
  const original=JSON.stringify(oldBlink(),null,4)+'\n';let backedUp;
  const result=await readImportedProject(original,catalog,async contents=>{backedUp=contents;return 'backup.json';});
  assert.equal(backedUp,original);assert.equal(result.project.formatVersion,4);assert.match(result.conversionNotice,/backup.json/);
  const current=serializeProject(result.project);
  await readImportedProject(current,catalog,()=>assert.fail('no backup for current format'));
});

test('browser backup is exact, idempotent and retains multiple originals with the same project ID',async()=>{
  const p=oldBlink(),original=JSON.stringify(p,null,4)+'\n',contents=serializeProject(open(p));
  const storage=memoryStorage({[PROJECT_KEY]:JSON.stringify({[p.id]:original})});
  const backup=await saveBrowserProject(p.id,contents,original,storage);
  assert.equal(storage.getItem(backup),original);assert.equal(browserRecords(storage)[p.id],contents);
  await saveBrowserProject(p.id,contents,original,storage);
  assert.equal([...storage.map.keys()].filter(k=>k.startsWith(BACKUP_PREFIX)).length,1);
  const other=JSON.stringify({...p,name:'Changed'});
  assert.notEqual(await backupBrowserProject(other,storage),backup);assert.equal(storage.getItem(backup),original);
});

test('browser quota and concurrent edits never replace an unprotected original',async()=>{
  const p=oldBlink(),raw=JSON.stringify(p),contents=serializeProject(open(p));
  const storage=memoryStorage({[PROJECT_KEY]:JSON.stringify({[p.id]:raw})});
  const set=storage.setItem;
  storage.setItem=(key,value)=>{if(key.startsWith(BACKUP_PREFIX))throw Error('Quota');set(key,value);};
  await assert.rejects(saveBrowserProject(p.id,contents,raw,storage),/Quota/);assert.equal(browserRecords(storage)[p.id],raw);
  storage.setItem=(key,value)=>{set(key,value);if(key.startsWith(BACKUP_PREFIX))set(PROJECT_KEY,JSON.stringify({[p.id]:'concurrent change'}));};
  await assert.rejects(saveBrowserProject(p.id,contents,raw,storage),/изменился/);assert.equal(browserRecords(storage)[p.id],'concurrent change');
});
