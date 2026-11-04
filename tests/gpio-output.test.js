import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {mosfetProject} from './mosfet-fixture.js';
import {relayProject} from './relay-fixture.js';
import {firmwareProject} from './firmware-fixture.js';
import {OUTPUT_MODULE} from '../src/gpio/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {validateGraph,hardwareMatches,nodePorts,connectNodes} from '../src/logic/model.js';
import {logicLibraryEntries} from '../src/logic/library.js';
import {generateFirmware} from '../src/firmware/generator.js';

test('every catalog module exposes actions and typed data; output commands share one block',()=>{
 for(const module of catalog.modules){
  assert.equal(module.compatibility.projectFormat,4,module.id);
  for(const port of [...module.inputs,...module.outputs])assert.ok(['event','number','text','boolean'].includes(port.type),module.id+' '+port.id);
 }
 const control=catalog.modules.find(m=>m.id===OUTPUT_MODULE);
 assert.deepEqual(control.inputs.map(p=>p.id),['on','off','toggle']);
 assert.ok(!control.parameters.action&&!control.parameters.defaultValue);
 for(const id of ['clex.logic.relay','clex.logic.mosfet','clex.logic.gpio-toggle'])assert.ok(!catalog.modules.some(m=>m.id===id));
 for(const definition of catalog.modules.filter(m=>m.kind==='hardware')){
  const matches=hardwareMatches({moduleId:definition.id},control.constraints.hardware,catalog);
  if(['clex.hardware.led','clex.hardware.mosfet','clex.hardware.relay'].includes(definition.id))assert.equal(matches,true);
  if(definition.display||definition.i2c||definition.stepper||definition.microphone||definition.hardwareInterface||definition.softwareInterface)assert.equal(matches,false,definition.id);
 }
});
test('independent output commands round-trip without fallback state or a data input',()=>{
 for(const project of [firmwareProject(),mosfetProject().project,relayProject().project]){
  assert.deepEqual(parseProject(serializeProject(project)),project);
  for(const node of project.logic.nodes.filter(n=>n.moduleId===OUTPUT_MODULE)){
   const ports=nodePorts(node,catalog,project);
   assert.ok(ports.inputs.every(p=>p.type==='event'));assert.equal(ports.outputs.find(p=>p.id==='state').type,'boolean');
   assert.deepEqual(ports.outputs.map(p=>p.id),['on','off','done','state']);
  }
  assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[]);generateFirmware(project,catalog);
 }
});
test('different event results can drive one command, exact duplicate edges are rejected at connection and import',()=>{
 const project=firmwareProject(true),source=project.logic.nodes.find(n=>n.moduleId==='clex.logic.gpio-read'),target=project.logic.nodes.find(n=>n.moduleId===OUTPUT_MODULE);
 const connection={source:source.id,sourceHandle:'inactive',target:target.id,targetHandle:'on'};
 project.logic=connectNodes(project.logic,catalog,connection,project);
 assert.deepEqual(parseProject(serializeProject(project)),project);
 assert.throws(()=>connectNodes(project.logic,catalog,connection,project),/уже существует/);
 project.logic.edges.push({...project.logic.edges.at(-1),id:crypto.randomUUID()});assert.throws(()=>serializeProject(project),/связь/);
});
test('mounted devices appear with their own actions and exact component binding before adding a block',()=>{
 const project=firmwareProject(),entries=logicLibraryEntries(catalog.modules.filter(m=>m.kind==='logic'),project,catalog);
 for(const component of project.components){
  const own=entries.filter(e=>e.component?.id===component.id);assert.ok(own.length);
  assert.ok(own.every(e=>e.group===component.name));
 }
 assert.ok(entries.some(e=>e.name==='События кнопки'));
 assert.ok(!entries.some(e=>e.module.id==='clex.logic.gpio-read'));
 assert.ok(entries.some(e=>e.name==='Условие'));
 assert.ok(entries.some(e=>e.name==='Управлять светодиодом'));
 assert.ok(!entries.some(e=>e.module.id==='clex.logic.mqtt-send'));
});
test('strict current-format validation rejects unknown data types; opening old files uses the upgrader',()=>{
 const project=firmwareProject();
 for(const formatVersion of [1,2,3,5])assert.throws(()=>parseProject(JSON.stringify({...project,formatVersion})),/Версия формата/);
 project.logic.edges[0].dataType='unknown';assert.throws(()=>serializeProject(project),/связь/);
});
