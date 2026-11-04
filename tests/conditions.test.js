import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {conditionProject} from './condition-fixture.js';
import {NUMERIC_BOARDS} from './numeric-fixture.js';
import {readConditions,readConditionRows,newCondition} from '../src/logic/conditions.js';
import {validateGraph,updateNode,nodePorts,withLogic,connectNodes} from '../src/logic/model.js';
import {portSections} from '../src/logic/portGroups.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware,cString} from '../src/firmware/generator.js';
import {numericFirmware} from '../src/firmware/drivers/numeric.js';
import {runHostC} from './host-c.js';

test('mixed conditions preserve typed data, event order and project persistence on every concrete board',()=>{
 for(const board of NUMERIC_BOARDS){
  const {project,nodes}=conditionProject(board);
  assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[]);
  assert.deepEqual(parseProject(serializeProject(project)),project);
  const sections=portSections(nodePorts(nodes.condition,catalog,project));
  assert.deepEqual(sections.map(s=>s.id),['signals','data']);
  assert.ok(sections[0].inputs.every(p=>p.type==='event'));
  assert.ok(sections[1].inputs.every(p=>p.type!=='event'));
  const source=generateFirmware(project,catalog).mainC;
  assert.match(source,/strstr\(actual,expected\)/);assert.match(source,/bool combined=true/);
 }
});

test('editing and removing a condition preserves unrelated links and removes incompatible typed inputs',()=>{
 const {project,nodes}=conditionProject();
 const rows=readConditions(nodes.condition);rows[1]=newCondition('c2','text');
 const graph=updateNode(project.logic,nodes.condition.id,{parameters:{...nodes.condition.parameters,conditions:JSON.stringify(rows)}},catalog,project);
 assert.ok(!graph.edges.some(e=>e.target===nodes.condition.id&&e.targetHandle==='c2.value'));
 assert.ok(graph.edges.some(e=>e.target===nodes.condition.id&&e.targetHandle==='c1.value'));
 assert.ok(graph.edges.some(e=>e.source===nodes.condition.id&&e.sourceHandle==='failed'));
 assert.ok(validateGraph(withLogic(project,graph),catalog).some(i=>i.code==='logic-input'));
});

test('invalid rows, duplicate IDs, oversized text and unknown operations cannot enter generated firmware',()=>{
 for(const rows of [[],[newCondition(),newCondition()],[{...newCondition(),type:'event'}],[{...newCondition('c1','text'),reference:'x'.repeat(257)}],[{...newCondition('c1','number'),tolerance:-1}],[{...newCondition(),operator:'execute'}]]){
  const {project,nodes}=conditionProject();nodes.condition.parameters.conditions=JSON.stringify(rows);
  assert.throws(()=>generateFirmware(project,catalog),/схему|услов|сравнен/i);
 }
});

test('an invalid comparison value remains editable without dropping its data connections',()=>{
 const {project,nodes}=conditionProject(),rows=readConditions(nodes.condition);
 rows[2].reference='я'.repeat(129);
 const graph=updateNode(project.logic,nodes.condition.id,{parameters:{...nodes.condition.parameters,conditions:JSON.stringify(rows)}},catalog,project);
 assert.deepEqual(graph.edges,project.logic.edges);
 assert.equal(readConditionRows(graph.nodes.find(n=>n.id===nodes.condition.id)).length,3);
 assert.throws(()=>generateFirmware(withLogic(project,graph),catalog),/схему/);
});

function body(source,index){
 const match=new RegExp('static void node_'+index+'\\((?:void)?\\)\\s*\\{').exec(source);assert.ok(match);
 let end=match.index+match[0].length,depth=1;
 while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
 assert.equal(depth,0);return source.slice(match.index,end);
}

for(const board of ['doit-esp32-devkit-v1-30pin','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340']){
 test('generated mixed conditions execute AND, OR, NOT and invalid-data handling on '+board,()=>{
  for(const combine of ['all','any'])for(const negate of [false,true]){
   const {project,nodes,button}=conditionProject(board,{combine,negate}),bundle=generateFirmware(project,catalog);
   const sorted=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),index=new Map(sorted.map((n,i)=>[n.id,i])),i=index.get(nodes.condition.id),avr=bundle.platform==='arduino-avr';
   const hardware=[...project.components].sort((a,b)=>a.id<b.id?-1:1).findIndex(c=>c.id===button.id);
   const fn=body(bundle.mainC,i),names=[...new Set([...fn.matchAll(/\b(node_\d+(?:_[a-zA-Z0-9_]+)?)\(\)/g)].map(m=>m[1]))].filter(n=>n!=='node_'+i);
   const signals=['changed','matched','unmatched','failed'];
   const signalName=port=>avr?'node_'+index.get(nodes[port]?.id):'node_'+i+'_emit_'+port;
   const stubs=names.map(name=>{const hit=signals.findIndex(p=>signalName(p)===name);return 'static void '+name+'(void){'+(hit>=0?'hits['+hit+']++;':'')+'}';}).join('\n');
   const runtime=numericFirmware(sorted,index,cString,{avr}).source;
   const source=runtime+'\n#include <assert.h>\nstatic int hits[4];\nstatic bool input_stable_'+hardware+';\nstatic char text_'+index.get(nodes.source.id)+'[64];\n'+stubs+'\n'+fn+`\nstatic void check(double number,bool button,const char *text,int expected){
    numeric_${index.get(nodes.parse.id)}.value=number;input_stable_${hardware}=button;snprintf(text_${index.get(nodes.source.id)},64,"%s",text);
    memset(hits,0,sizeof(hits));node_${i}();assert(hits[expected]==1);assert(hits[1]+hits[2]+hits[3]==1);
   }\nint main(void){`+
    [0,120].flatMap(number=>[false,true].flatMap(button=>['120 Па','none'].map(text=>{
     const values=[number>100,negate?!button:button,text.includes('Па')],matched=combine==='all'?values.every(Boolean):values.some(Boolean);
     return 'check('+number+','+button+','+cString(text)+','+(matched?1:2)+');';
    }))).join('')+'check(NAN,true,"120 Па",3);return 0;}';
   runHostC(source,'clex-condition-');
  }
 });
}

test('a second typed data source can replace a configured comparison value',()=>{
 let {project,nodes}=conditionProject();
 project=withLogic(project,connectNodes(project.logic,catalog,{source:nodes.parse.id,sourceHandle:'value',target:nodes.condition.id,targetHandle:'c1.reference'},project));
 assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[]);
 assert.match(generateFirmware(project,catalog).mainC,/clex_number_evaluate\(&comparison,numeric_\d+\.value,false,5,numeric_\d+\.value/);
});
