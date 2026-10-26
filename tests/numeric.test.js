import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {numericProject,NUMERIC_BOARDS} from './numeric-fixture.js';
import {validateGraph,nodePorts,updateNode,connectNodes,withLogic} from '../src/logic/model.js';
import {validateAssembly} from '../src/assembly/model.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
const errors=project=>[...validateAssembly(project,catalog),...validateGraph(project,catalog)].filter(i=>i.severity==='error');

test('numerical blocks generate with relays on all supported boards and MQTT on ESP32',()=>{
 for(const boardId of NUMERIC_BOARDS)for(const mqtt of boardId.startsWith('arduino')?[false]:[false,true]){
  const {project}=numericProject(boardId,{mqtt});
  assert.deepEqual(errors(project),[],boardId);
  const fw=generateFirmware(project,catalog);
  assert.match(fw.mainC,/clex_text_number_parse/);assert.match(fw.mainC,/clex_number_evaluate/);
  assert.deepEqual(parseProject(serializeProject(project)),project);
 }
});
test('range validation supports fractional limits, dynamic bounds and rejects empty or reversed ranges',()=>{
 const {project,nodes}=numericProject();
 Object.assign(nodes.condition.parameters,{lower:-10000.25,upper:10000.25});
 assert.deepEqual(errors(project),[]);
 nodes.condition.parameters.lower=20000;
 assert.ok(errors(project).some(i=>i.code==='numeric-logic'));
 const dynamic=withLogic(project,connectNodes(project.logic,catalog,{source:nodes.parse.id,sourceHandle:'value',target:nodes.condition.id,targetHandle:'lower'},project));
 assert.deepEqual(errors(dynamic),[]);
 nodes.condition.parameters.lower=10000.25;nodes.condition.parameters.includeLower=false;
 assert.ok(errors(project).some(i=>i.message.includes('Пустой диапазон')));
 nodes.condition.parameters.lower=-1;nodes.condition.parameters.upper=Infinity;
 assert.ok(errors(project).some(i=>i.code==='logic-parameter'));
});
test('changing condition mode removes inactive bindings and preserves completion wiring',()=>{
 const {project,nodes}=numericProject();
 const graph=updateNode(project.logic,nodes.condition.id,{parameters:{...nodes.condition.parameters,mode:'compare'}},catalog,project);
 const p=withLogic(project,graph),condition=p.logic.nodes.find(n=>n.id===nodes.condition.id);
 assert.deepEqual(errors(p),[]);
 assert.ok(nodePorts(condition,catalog,p).outputs.some(port=>port.id==='result'));
 assert.ok(!nodePorts(condition,catalog,p).outputs.some(port=>port.id==='isBelow'));
 assert.ok(!graph.edges.some(e=>e.source===condition.id&&e.sourceHandle==='isBelow'));
 assert.equal(graph.edges.filter(e=>e.source===condition.id&&e.sourceHandle==='changed').length,2);
});
test('MQTT text requires explicit conversion and invalid affixes cannot enter generated C',()=>{
 const {project,nodes}=numericProject(undefined,{mqtt:true});
 assert.throws(()=>connectNodes(project.logic,catalog,{source:nodes.source.id,sourceHandle:'payload',target:nodes.condition.id,targetHandle:'value'},project),/Несовместимые/);
 nodes.parse.parameters.suffix='Па\0';
 assert.ok(errors(project).some(i=>i.code==='numeric-logic'));
 assert.throws(()=>generateFirmware(project,catalog));
});
test('range semantics change firmware while graph positions do not',async()=>{
 const {project,nodes}=numericProject();
 const before=await firmwareFingerprint(generateFirmware(project,catalog));nodes.condition.position.x+=20;
 assert.equal(await firmwareFingerprint(generateFirmware(project,catalog)),before);
 nodes.condition.parameters.lower=-9000;
 assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog)),before);
});
