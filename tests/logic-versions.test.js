import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {selectNumberProject} from './select-number-fixture.js';
import {compatibleVersion,compareVersions} from '../src/catalog/versions.js';
import {logicVersionProblem} from '../src/logic/versions.js';
import {addNode,connectNodes,updateNode,removeElements,nodePorts,withLogic,validateGraph} from '../src/logic/model.js';
import {visiblePorts} from '../src/logic/presentation.js';
import {openProject} from '../src/projects/upgrade.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';

function outdatedProject(){
 const {project,nodes}=selectNumberProject();
 nodes.select.moduleVersion='1.0.0';nodes.select.parameters={firstValue:3,secondValue:7};
 project.moduleVersions[nodes.select.moduleId]='1.0.0';
 project.logic.edges=project.logic.edges.map(edge=>edge.source===nodes.select.id?{...edge,sourceHandle:({case1:'first',case2:'second'})[edge.sourceHandle]||edge.sourceHandle}:edge);
 return {project,nodes};
}
test('block version compatibility uses the major version and rejects downgrades',()=>{
 for(const [saved,installed,expected] of [['1.0.0','1.0.1',true],['1.9.0','1.10.0',true],['1.10.0','1.9.0',false],['1.0.0','2.0.0',false],['2.0.0','1.0.0',false],['2.0.0','2.0.0',true],['bad','2.0.0',false]])assert.equal(compatibleVersion(saved,installed),expected,saved+' -> '+installed);
 assert.equal(compareVersions('1.10.0','1.9.0'),1);
});
test('incompatible blocks survive open/save, movement and missing old contacts without migration',()=>{
 const {project,nodes}=outdatedProject(),original=structuredClone(project);
 const opened=openProject(serializeProject(project),catalog);
 assert.equal(opened.upgraded,false);assert.deepEqual(opened.project,original);
 const ports=visiblePorts(nodes.select,project,catalog);
 for(const edge of project.logic.edges.filter(edge=>edge.source===nodes.select.id||edge.target===nodes.select.id)){
  const direction=edge.source===nodes.select.id?'outputs':'inputs',handle=direction==='outputs'?edge.sourceHandle:edge.targetHandle;
  assert.ok(ports[direction].some(port=>port.id===handle&&port.legacy&&port.connected));
 }
 assert.throws(()=>updateNode(project.logic,nodes.select.id,{parameters:{valueType:'boolean'}},catalog,project),/Замените/);
 const moved=withLogic(project,updateNode(project.logic,nodes.select.id,{position:{x:90,y:80},name:'Прежний выбор'},catalog,project));
 assert.deepEqual(moved.logic.edges,original.logic.edges);
 assert.deepEqual(parseProject(serializeProject(moved)),moved);
 assert.deepEqual(project,original);
});
test('new and incompatible old blocks can coexist until manual rewiring and removal',()=>{
 const {project,nodes}=outdatedProject(),module=catalog.modules.find(m=>m.id===nodes.select.moduleId);
 let current=withLogic(project,addNode(project.logic,module,[],project,catalog));
 const replacement=current.logic.nodes.at(-1);
 assert.equal(replacement.moduleVersion,'2.0.0');assert.deepEqual(current.logic.edges,project.logic.edges);
 assert.equal(current.moduleVersions[module.id],'2.0.0');
 current=parseProject(serializeProject(current));
 assert.equal(current.logic.nodes.find(n=>n.id===nodes.select.id).moduleVersion,'1.0.0');
 assert.throws(()=>generateFirmware(current,catalog),/Замените/);
 assert.throws(()=>connectNodes(current.logic,catalog,{source:nodes.select.id,sourceHandle:'first',target:nodes.second.id,targetHandle:'trigger'},current),/Замените/);
 // Rebuild only the chosen section from the saved wiring as a guide.
 const first=updateNode(current.logic,replacement.id,{parameters:{...replacement.parameters,cases:JSON.stringify([{id:'case1',value:3},{id:'case2',value:7}])}},catalog,current);
 current=withLogic(current,first);
 for(const edge of project.logic.edges.filter(edge=>edge.source===nodes.select.id||edge.target===nodes.select.id)){
  const connection={...edge,source:edge.source===nodes.select.id?replacement.id:edge.source,target:edge.target===nodes.select.id?replacement.id:edge.target,sourceHandle:edge.source===nodes.select.id?({first:'case1',second:'case2'})[edge.sourceHandle]||edge.sourceHandle:edge.sourceHandle};
  // Data inputs accept one source, so the old incoming connection is removed explicitly.
  if(edge.target===nodes.select.id)current=withLogic(current,removeElements(current.logic,[],[edge.id]));
  current=withLogic(current,connectNodes(current.logic,catalog,connection,current));
 }
 current=withLogic(current,removeElements(current.logic,[nodes.select.id]));
 assert.deepEqual(validateGraph(current,catalog).filter(issue=>issue.severity==='error'),[]);
 generateFirmware(current,catalog);
 assert.deepEqual(parseProject(serializeProject(current)),current);
});
test('mixed-version index remains correct when the newest block is removed',()=>{
 const {project}=outdatedProject(),module=catalog.modules.find(m=>m.id==='clex.logic.select-number');
 let current=withLogic(project,addNode(project.logic,module,[],project,catalog));
 current=withLogic(current,removeElements(current.logic,[current.logic.nodes.at(-1).id]));
 assert.equal(current.moduleVersions[module.id],'1.0.0');
 assert.deepEqual(parseProject(serializeProject(current)),current);
});
test('compatible updates run existing settings on ESP and Nano without changing stored versions',()=>{
 for(const board of ['waveshare-esp32-s3-eth','arduino-nano-atmega328p-ch340']){
  const {project,nodes}=selectNumberProject(board),original=structuredClone(project);
  const installed={...catalog,modules:catalog.modules.map(module=>module.kind==='logic'?{...module,version:module.version==='2.0.0'?'2.1.0':'1.1.0'}:module)};
  assert.equal(logicVersionProblem(nodes.select,installed),null);
  assert.deepEqual(validateGraph(project,installed).filter(issue=>issue.severity==='error'),[]);
  assert.ok(!nodePorts(nodes.select,installed,project).outputs.some(port=>port.legacy));
  generateFirmware(project,installed);
  assert.deepEqual(project,original);
 }
});
test('a newer saved block requires an application update rather than a silent downgrade',()=>{
 const {project,nodes}=selectNumberProject();
 nodes.select.moduleVersion='2.1.0';project.moduleVersions[nodes.select.moduleId]='2.1.0';
 assert.match(logicVersionProblem(nodes.select,catalog),/Обновите приложение/);
 assert.throws(()=>generateFirmware(project,catalog),/Обновите приложение/);
});
test('missing module definitions preserve all saved contacts and block firmware generation',()=>{
 const {project,nodes}=selectNumberProject();
 const missing={...catalog,modules:catalog.modules.filter(module=>module.id!==nodes.select.moduleId)};
 const ports=visiblePorts(nodes.select,project,missing);
 assert.equal(ports.inputs.length+ports.outputs.length,5);
 assert.ok([...ports.inputs,...ports.outputs].every(port=>port.legacy));
 assert.throws(()=>generateFirmware(project,missing),/Блок недоступен/);
});
