import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostC} from './host-c.js';
import {catalog} from './catalog-fixture.js';
import {selectNumberProject} from './select-number-fixture.js';
import {espNowButtonProject} from './espnow-fixture.js';
import {addNode,connectNodes,withLogic,validateGraph,nodePorts} from '../src/logic/model.js';
import {presentPort} from '../src/logic/presentation.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';

test('selection reads the latest number on an independent event without weakening other consumers',()=>{
  let {project,nodes}=selectNumberProject();
  let graph={...project.logic,edges:project.logic.edges.filter(edge=>!(edge.target===nodes.select.id&&edge.dataType==='event'))};
  graph=connectNodes(graph,catalog,{source:nodes.timer.id,sourceHandle:'tick',target:nodes.select.id,targetHandle:'trigger'},project);
  project=withLogic(project,graph);
  assert.equal(validateGraph(project,catalog).filter(issue=>issue.severity==='error').length,0);
  graph=connectNodes(graph,catalog,{source:nodes.counter.id,sourceHandle:'value',target:nodes.first.id,targetHandle:'number'},project);
  assert.ok(validateGraph(withLogic(project,graph),catalog).some(issue=>issue.code==='logic-order'&&issue.nodeId===nodes.first.id));
});

test('selection requires both inputs and distinct valid integers, with readable branch labels',()=>{
  const {project,nodes}=selectNumberProject();
  const ports=nodePorts(nodes.select,catalog,project);
  assert.deepEqual(ports.outputs.map(port=>presentPort(port,nodes.select,project,catalog).name),['Значение 0','Значение 1','Другое значение']);
  assert.ok(validateGraph({...project,logic:{...project.logic,edges:project.logic.edges.filter(edge=>edge.target!==nodes.select.id)}},catalog).filter(issue=>issue.code==='logic-input').length===2);
  nodes.select.parameters.secondValue=0;
  assert.ok(validateGraph(project,catalog).some(issue=>issue.code==='logic-parameter'));
  nodes.select.parameters.secondValue=0.5;
  assert.ok(validateGraph(project,catalog).some(issue=>issue.code==='logic-parameter'));
  const module=catalog.modules.find(module=>module.id==='clex.logic.serial');
  const graph=addNode(project.logic,module,[],project,catalog);
  assert.throws(()=>connectNodes(graph,catalog,{source:nodes.first.id,sourceHandle:'text',target:nodes.select.id,targetHandle:'value'},project),/Несовместимые/);
  assert.throws(()=>connectNodes(graph,catalog,{source:nodes.select.id,sourceHandle:'first',target:nodes.counter.id,targetHandle:'reset'},project),/Циклические/);
});

test('selection saves cleanly and only semantic settings change the firmware fingerprint',async()=>{
  const {project,nodes}=selectNumberProject();
  assert.deepEqual(parseProject(serializeProject(project)),project);
  const before=await firmwareFingerprint(generateFirmware(project,catalog));
  nodes.select.position.x+=50;
  assert.equal(await firmwareFingerprint(generateFirmware(project,catalog)),before);
  nodes.select.parameters.secondValue=5;
  assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog)),before);
});

test('ESP-NOW chooses explicit opposite commands from the current radio state',()=>{
  const fixture=espNowButtonProject();let project=fixture.project;
  let graph={...project.logic,edges:project.logic.edges.filter(edge=>edge.source!==fixture.input.id)};
  graph=addNode(graph,catalog.modules.find(module=>module.id==='clex.logic.select-number'),project.components,project,catalog);
  const select=graph.nodes.at(-1),normal=graph.nodes.find(node=>node.moduleId==='clex.logic.espnow-send'&&node.parameters.command==='SET_NORMAL');
  for(const [source,sourceHandle,target,targetHandle] of [
    [fixture.input,'falling',select,'trigger'],[fixture.nodes.status,'mode',select,'value'],
    [select,'first',fixture.nodes.send,'trigger'],[select,'second',normal,'trigger'],
  ])graph=connectNodes(graph,catalog,{source:source.id,sourceHandle,target:target.id,targetHandle},{...project,logic:graph});
  project=withLogic(project,graph);
  assert.deepEqual(validateGraph(project,catalog).filter(issue=>issue.severity==='error'),[]);
  for(const [branch,command,mode]of [['first','SET_LR','lr'],['second','SET_NORMAL','normal']]) {
    const edge=graph.edges.find(edge=>edge.source===select.id&&edge.sourceHandle===branch),send=graph.nodes.find(node=>node.id===edge.target);
    assert.equal(send.parameters.command,command);
    const completed=graph.edges.find(edge=>edge.source===send.id&&edge.sourceHandle==='completed');
    assert.equal(graph.nodes.find(node=>node.id===completed.target).parameters.mode,mode);
    assert.equal(graph.edges.filter(edge=>edge.source===send.id&&edge.sourceHandle!=='completed').length,0);
  }
  generateFirmware(project,catalog);
});

// Execute the actual generated selector body, with event outputs counted by stubs.
// ESP-IDF and a physical board are not needed for this host-side C check.
function functionBody(source,index) {
  const match=new RegExp('static void node_'+index+'\\([^)]*\\)\\s*\\{').exec(source);
  assert.ok(match);
  let end=match.index+match[0].length,depth=1;
  while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  assert.equal(depth,0);
  return source.slice(match.index,end);
}
for(const board of ['waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340']) {
  test('generated selection executes exactly one branch on '+board,()=>{
   for(const limits of [false,true]) {
    const {project,nodes}=selectNumberProject(board,limits?{firstValue:-2147483648,secondValue:2147483647}:{});
    const sorted=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),i=sorted.findIndex(node=>node.id===nodes.select.id),counter=sorted.findIndex(node=>node.id===nodes.counter.id);
    const avr=board.startsWith('arduino-');
    const source=generateFirmware(project,catalog).mainC;
    const events=avr?Object.fromEntries(['first','second','other'].map(key=>[key,'node_'+sorted.findIndex(node=>node.id===nodes[key].id)])):Object.fromEntries(['first','second','other'].map(key=>[key,'node_'+i+'_emit_'+key]));
    const harness=`#include <stdint.h>
#include <math.h>
#include <assert.h>
static ${avr?'int64_t':'double'} value_${counter};
static int hits[3];
${Object.values(events).map((name,j)=>'static void '+name+'(void){hits['+j+']++;}').join('\n')}
${functionBody(source,i)}
static void check(${avr?'int64_t':'double'} value,int expected){int previous=hits[0]+hits[1]+hits[2];int selected=hits[expected];value_${counter}=value;node_${i}();assert(hits[expected]==selected+1);assert(hits[0]+hits[1]+hits[2]==previous+1);}
int main(void){${limits?'check(-2147483648LL,0);check(2147483647LL,1);check(2147483646LL,2);check(-2147483647LL,2);check(4294967295LL,2);':'check(0,0);check(1,1);check(0,0);check(2,2);check(-1,2);check(2147483647LL,2);check(4294967295LL,2);'}${avr?'':'check(0.5,2);check(NAN,2);check(INFINITY,2);'}return 0;}
`;
    runHostC(harness,'clex-select-');
   }
  });
}
