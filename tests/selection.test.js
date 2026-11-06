import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {selectionProject} from './selection-fixture.js';
import {selectNumberProject} from './select-number-fixture.js';
import {selectionOutputs,selectionIssues,selectionRows} from '../src/logic/selection.js';
import {nodePorts,updateNode,withLogic,validateGraph} from '../src/logic/model.js';
import {generateFirmware,cString} from '../src/firmware/generator.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {runHostC} from './host-c.js';

test('old numeric selections remain saved but require replacement instead of running legacy settings',()=>{
 const {project,nodes}=selectNumberProject();
 nodes.select.moduleVersion='1.0.0';nodes.select.parameters={firstValue:3,secondValue:7};
 project.moduleVersions[nodes.select.moduleId]='1.0.0';
 project.logic.edges=project.logic.edges.map(edge=>edge.source===nodes.select.id?{...edge,sourceHandle:({case1:'first',case2:'second'})[edge.sourceHandle]||edge.sourceHandle}:edge);
 const original=structuredClone(project);
 assert.ok(selectionIssues(nodes.select).length);
 assert.deepEqual(parseProject(serializeProject(project)),original);
 const issue=validateGraph(project,catalog).find(issue=>issue.code==='logic-module');
 assert.match(issue.message,/v1\.0\.0.*v2\.0\.0/);assert.match(issue.message,/Замените/);
 assert.match(issue.message,/формат настроек/);
 const ports=nodePorts(nodes.select,catalog,project);
 assert.deepEqual(ports.outputs.map(p=>p.id),['first','second','other']);
 assert.ok([...ports.inputs,...ports.outputs].every(port=>port.legacy));
 assert.throws(()=>generateFirmware(project,catalog),/Замените/);
 assert.deepEqual(project,original);
});
test('text and boolean selections have typed inputs, stable branches and ordinary event chains',()=>{
 for(const type of ['text','boolean','number']){
  const {project,select}=selectionProject(type);
  assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[]);
  assert.equal(nodePorts(select,catalog,project).inputs.find(p=>p.id==='value').type,type);
  assert.deepEqual(parseProject(serializeProject(project)),project);
  if(type==='boolean')assert.deepEqual(selectionOutputs(select).map(p=>[p.id,p.name]),[['yes','Да'],['no','Нет']]);
 }
});
test('editing and deleting cases preserve other connections; changing type preserves only the trigger',()=>{
 const {project,select}=selectionProject('text');
 let rows=selectionRows(select);
 let graph=updateNode(project.logic,select.id,{parameters:{...select.parameters,cases:JSON.stringify(rows.map(r=>r.id==='case1'?{...r,value:'START'}:r))}},catalog,project);
 assert.deepEqual(graph.edges,project.logic.edges);
 rows=rows.filter(r=>r.id!=='case2');
 graph=updateNode(graph,select.id,{parameters:{...select.parameters,cases:JSON.stringify(rows)}},catalog,project);
 assert.ok(!graph.edges.some(e=>e.source===select.id&&e.sourceHandle==='case2'));
 assert.ok(graph.edges.some(e=>e.source===select.id&&e.sourceHandle==='case3'));
 const boolean=updateNode(project.logic,select.id,{parameters:{...select.parameters,valueType:'boolean',cases:''}},catalog,project);
 assert.equal(boolean.edges.filter(e=>e.target===select.id&&e.targetHandle==='trigger').length,1);
 assert.ok(!boolean.edges.some(e=>e.source===select.id||e.target===select.id&&e.targetHandle==='value'));
 assert.equal(nodePorts(boolean.nodes.find(n=>n.id===select.id),catalog,withLogic(project,boolean)).inputs.find(p=>p.id==='value').type,'boolean');
});
test('invalid, duplicate and oversized cases are rejected without hiding valid branch IDs',()=>{
 const {select}=selectionProject('text');
 for(const values of [['ON','ON'],['a\0b'],['я'.repeat(129)],Array(17).fill('x')]){
  const node={...select,parameters:{...select.parameters,cases:JSON.stringify(values.map((value,i)=>({id:'case'+(i+1),value})))}};
  assert.ok(selectionIssues(node).length);
 }
 const duplicate={...select,parameters:{...select.parameters,cases:'[{"id":"case1","value":"ON"},{"id":"case2","value":"ON"}]'}};
 assert.deepEqual(selectionOutputs(duplicate).map(p=>p.id),['case1','case2','other']);
 const number={...select,parameters:{...select.parameters,valueType:'number',cases:'[{"id":"case1","value":0.5}]'}};
 assert.ok(selectionIssues(number).length);
 assert.ok(selectionIssues({...select,parameters:{...select.parameters,valueType:'invalid'}}).length);
});
function body(source,index){
 const start=new RegExp('static void node_'+index+'\\([^)]*\\)\\s*\\{').exec(source);assert.ok(start);
 let end=start.index+start[0].length,depth=1;
 while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
 assert.equal(depth,0);return source.slice(start.index,end);
}
for(const board of ['doit-esp32-devkit-v1-30pin','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340']){
 for(const type of ['text','boolean','number']){
  test('generated '+type+' selection executes one matching branch on '+board,()=>{
   const values=type==='text'?['ON','OFF','GROUP ON','GROUP OFF','Привет "ESP"\\','']:type==='number'?Array.from({length:16},(_,i)=>i-8):null;
   const {project,select,source,sinks}=selectionProject(type,board,values);
   const code=generateFirmware(project,catalog).mainC,nodes=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),index=nodes.findIndex(n=>n.id===select.id),sourceIndex=nodes.findIndex(n=>n.id===source.id),avr=board.startsWith('arduino-');
   const outputs=selectionOutputs(select),declaration=type==='text'?'static const char *text_'+sourceIndex+';':type==='boolean'?'static struct {bool valid;} numeric_'+sourceIndex+';':'static '+(avr?'int64_t':'double')+' value_'+sourceIndex+';';
   const input=type==='text'?'text_'+sourceIndex:type==='boolean'?'numeric_'+sourceIndex+'.valid':'value_'+sourceIndex;
   const functions=outputs.map((p,i)=>'static void '+(avr?'node_'+nodes.findIndex(n=>n.id===sinks[p.id].id):'node_'+index+'_emit_'+p.id)+'(void){hits['+i+']++;}').join('\n');
   const checks=type==='text'?[...values.map((v,i)=>[cString(v),i]),['"on"',values.length],['"ON "',values.length],['"GROUP"',values.length],['NULL',values.length]]:type==='boolean'?[['true',0],['false',1],['true',0]]:[...values.map((v,i)=>[String(v),i]),['1000',values.length]];
   const harness='#include <stdint.h>\n#include <stdbool.h>\n#include <string.h>\n#include <stddef.h>\n#include <assert.h>\n#define PSTR(s) (s)\n#define strcmp_P strcmp\n'+declaration+'\nstatic int hits['+outputs.length+'];\n'+functions+'\n'+body(code,index)+'\nint main(void){\n'+checks.map(([v,i])=>'  memset(hits,0,sizeof(hits)); '+input+'='+v+'; node_'+index+'(); assert(hits['+i+']==1); {int total=0; for(unsigned j=0;j<'+outputs.length+';j++){total+=hits[j];} assert(total==1);}\n').join('')+'  return 0;\n}\n';
   runHostC(harness,'clex-selection-');
   if(avr&&type==='text')assert.match(code,/strcmp_P\(selected,PSTR\(/);
  });
 }
}

test('Nano selection preserves fractional numeric input instead of truncating it to an integer case',()=>{
 const {project,select,source,sinks}=selectionProject('boolean','arduino-nano-atmega328p-ch340');
 select.parameters.valueType='number';select.parameters.cases='[{"id":"case1","value":0},{"id":"case2","value":1}]';
 project.logic.edges=project.logic.edges.map(edge=>edge.target===select.id&&edge.targetHandle==='value'?{...edge,sourceHandle:'value',dataType:'number'}:edge.source===select.id?{...edge,sourceHandle:edge.sourceHandle==='yes'?'case1':'case2'}:edge);
 const nodes=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),index=nodes.findIndex(n=>n.id===select.id),producer=nodes.findIndex(n=>n.id===source.id);
 const code=body(generateFirmware(project,catalog).mainC,index);
 assert.match(code,/double selected/);
 const declarations=['yes','no'].map((key,i)=>'static void node_'+nodes.findIndex(n=>n.id===sinks[key].id)+'(void){hits['+i+']++;}').join('\n');
 runHostC('#include <stdint.h>\n#include <math.h>\n#include <assert.h>\nstatic struct {double value;} numeric_'+producer+';\nstatic int hits[2];\n'+declarations+'\n'+code+'\nint main(void){numeric_'+producer+'.value=0;node_'+index+'();assert(hits[0]==1);numeric_'+producer+'.value=1;node_'+index+'();assert(hits[1]==1);numeric_'+producer+'.value=0.5;node_'+index+'();numeric_'+producer+'.value=NAN;node_'+index+'();assert(hits[0]==1&&hits[1]==1);return 0;}\n','clex-selection-fraction-');
});
