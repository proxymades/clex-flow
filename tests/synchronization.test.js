import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {catalog} from './catalog-fixture.js';
import {synchronizationProject} from './synchronization-fixture.js';
import {nodePorts,updateNode,validateGraph,withLogic} from '../src/logic/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {synchronizationFirmware} from '../src/firmware/drivers/synchronization.js';

test('synchronization has event inputs only and removes obsolete links when count changes',()=>{
 const {project:p,sync}=synchronizationProject(undefined,3);
 const ports=nodePorts(sync,catalog,p);
 assert.deepEqual(ports.inputs.filter(p=>p.id.startsWith('event')).map(p=>p.id),['event1','event2','event3']);
 assert.equal([...ports.inputs,...ports.outputs].every(p=>p.type==='event'),true);
 const graph=updateNode(p.logic,sync.id,{parameters:{...sync.parameters,eventCount:2}},catalog,p);
 assert.equal(graph.edges.some(e=>e.targetHandle==='event3'),false);
 assert.equal(graph.edges.filter(e=>e.target===sync.id&&e.targetHandle.startsWith('event')).length,2);
 assert.deepEqual(validateGraph(withLogic(p,graph),catalog).filter(i=>i.severity==='error'),[]);
});

test('synchronization generates all current ESP targets and survives save/open',()=>{
 for(const board of ['doit-esp32-devkit-v1-30pin','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano']) {
  const {project:p}=synchronizationProject(board);
  assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);
  const reopened=parseProject(serializeProject(p));
  assert.deepEqual(reopened,p);
  const bundle=generateFirmware(reopened,catalog);
  assert.match(bundle.mainC,/clex_sync_receive\(&sync_\d+, 1, /);
  assert.match(bundle.mainC,/node_\d+_event2\(\);/);
  assert.match(bundle.mainC,/clex_sync_expire/);
  assert.equal(bundle.mainC.includes('cycle_id'),false);
 }
 const {project:p,sync}=synchronizationProject();
 for(const bad of [0,17,2.5]) {
  sync.parameters.eventCount=bad;
  assert.throws(()=>generateFirmware(p,catalog),/Количество событий/);
 }
});

test('native synchronization and generated handlers: six voice actions, distinct inputs, restart, timeout and cancellation',()=>{
 const counts=[1,1,1,1,2,2];
 const nodes=counts.map((eventCount,i)=>({id:'s'+i,moduleId:'clex.logic.synchronize',parameters:{eventCount,timeoutMs:100}}));
 const index=new Map(nodes.map((n,i)=>[n.id,i]));
 const driver=synchronizationFirmware(nodes,index);
 const definitions=nodes.map((n,i)=>[
  `static void node_${i}_emit_started(void) { assert(sync_${i}.active); started[${i}]++; }`,
  `static void node_${i}_emit_done(void) { assert(!sync_${i}.active); completed[${i}]++; }`,
  `static void node_${i}_emit_timedOut(void) { assert(!sync_${i}.active); expired[${i}]++; }`,
  `static void node_${i}(void) { ${driver.operations.get(n.id)} }`,
  driver.extraFunctions.get(n.id)(),
 ].join('\n')).join('\n');
 const checks=String.raw`
static void acknowledge(bool right) {
  if(right) { node_1_event1(); node_3_event1(); node_4_event2(); node_5_event2(); }
  else { node_0_event1(); node_2_event1(); node_4_event1(); node_5_event1(); }
}
static void cancel_all(void) {
  node_0_cancel(); node_1_cancel(); node_2_cancel(); node_3_cancel(); node_4_cancel(); node_5_cancel();
}
int main(void) {
  clex_sync_t basic={0};
  assert(clex_sync_receive(&basic,0,0,0)==0);
  clex_sync_begin(&basic,16,0);
  for(unsigned i=0;i<15;i++) {
    assert(clex_sync_receive(&basic,i,0,0)==0);
    assert(clex_sync_receive(&basic,i,0,0)==0);
  }
  assert(clex_sync_receive(&basic,15,0,0)==1);
  assert(clex_sync_receive(&basic,15,0,0)==0);
  clex_sync_begin(&basic,2,0);
  assert(clex_sync_receive(&basic,0,0,0)==0);
  clex_sync_begin(&basic,2,1);
  assert(clex_sync_receive(&basic,1,1,0)==0);
  assert(clex_sync_receive(&basic,0,1,0)==1);
  clex_sync_begin(&basic,1,10);
  assert(clex_sync_receive(&basic,0,110,100)==2);
  assert(!clex_sync_expire(&basic,111,100));
  for(unsigned i=0;i<6;i++) {
    cancel_all();
    unsigned before=completed[i];
    switch(i) { case 0:node_0();break; case 1:node_1();break; case 2:node_2();break; case 3:node_3();break; case 4:node_4();break; default:node_5();break; }
    if(i<4) {
      bool right=i==1||i==3;
      acknowledge(!right); assert(completed[i]==before);
      acknowledge(right); assert(completed[i]==before+1);
      acknowledge(right); assert(completed[i]==before+1);
    } else {
      acknowledge(true); acknowledge(true); assert(completed[i]==before);
      acknowledge(false); assert(completed[i]==before+1);
      acknowledge(true); acknowledge(false); assert(completed[i]==before+1);
    }
    assert(started[i]==1);
  }
  cancel_all(); node_5(); acknowledge(false);
  node_5(); unsigned before=completed[5];
  acknowledge(true); assert(completed[5]==before);
  acknowledge(false); assert(completed[5]==before+1);
  node_0(); node_0_cancel(); before=completed[0]; acknowledge(false);
  assert(completed[0]==before);
  cancel_all(); node_4(); fake_now_ms=100;
  acknowledge(false); assert(expired[4]==1 && !sync_4.active);
  acknowledge(true); assert(expired[4]==1);
  cancel_all(); unsigned prior=expired[1]; node_1(); fake_now_ms+=100;
`+driver.poll+String.raw`
  assert(expired[1]==prior+1);
  cancel_all(); node_0(); node_1();
  assert(sync_0.active && sync_1.active);
  puts("PASS synchronization: distinct inputs, one result, all six routes, both reply orders, restart, timeout, cancel and independent blocks");
  return 0;
}
`;
 const directory=mkdtempSync(join(tmpdir(),'clex-sync-'));
 try {
  const source=join(directory,'sync.c'),binary=join(directory,'sync');
  writeFileSync(source,'#include <stdint.h>\n#include <stdbool.h>\n#include <stdio.h>\n#include <assert.h>\n'+
   driver.source+'\nstatic unsigned completed[6],started[6],expired[6];\nstatic uint64_t fake_now_ms;\nstatic int64_t esp_timer_get_time(void) {return (int64_t)(fake_now_ms*1000);}\n'+
   driver.prototypes+'\n'+definitions+'\n'+checks);
  execFileSync(process.env.CLEX_HOST_CC||'clang',['-std=c11','-Wall','-Wextra','-Werror',source,'-o',binary],{stdio:'pipe'});
  if(process.env.CLEX_SYNC_TARGET_CC)execFileSync(process.env.CLEX_SYNC_TARGET_CC,['-std=c11','-Wall','-Wextra','-Werror','-c',source,'-o',join(directory,'target.o')],{stdio:'pipe'});
  assert.match(execFileSync(binary,[],{encoding:'utf8'}),/PASS synchronization/);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
