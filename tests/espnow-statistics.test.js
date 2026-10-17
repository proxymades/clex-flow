import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostC} from './host-c.js';
import {ESPNOW_STATISTICS} from '../src/firmware/drivers/esp-idf/espnow-statistics.js';
import {catalog} from './catalog-fixture.js';
import {espNowProject} from './espnow-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {connectNodes,withLogic,validateGraph,nodePorts} from '../src/logic/model.js';

const support=String.raw`
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#define EN_PEER_COUNT 2
static unsigned en_count(void){return EN_PEER_COUNT;}
static int64_t now_us;
static int64_t esp_timer_get_time(void){return now_us;}
static uint64_t en_random(void){static uint64_t n=100;return ++n;}
`;
test('receiver ledger counts actual one-way delivery, not missing return reports',()=>{
 runHostC(support+ESPNOW_STATISTICS+String.raw`
static void baseline(unsigned peer,uint64_t boot){
 char request[25],report[34];en_stats_prepare(peer,request);en_stats_sent(peer,true);
 assert(en_stats_request(peer,(uint8_t*)request,24,report));en_stats_response(peer,boot,(uint8_t*)report,33);
 assert(en_stats_tx[peer].sent==0&&en_stats_tx[peer].receiver_boot==boot);
}
int main(void){
 char request[25],report[34];baseline(0,42);baseline(1,43);
 assert(!en_stats_read(0,5000000,true).valid);
 for(unsigned i=1;i<=100;i++){
  now_us+=1000000;en_stats_prepare(0,request);en_stats_sent(0,true);
  if(i==20||i==40||i==60||i==80||i==99)continue;
  assert(en_stats_request(0,(uint8_t*)request,24,report));
  // Duplicate delivery and dropped reverse reports do not become forward losses.
  assert(en_stats_request(0,(uint8_t*)request,24,report));
  if(i%7)en_stats_response(0,42,(uint8_t*)report,33);
 }
 en_stats_snapshot_t v=en_stats_read(0,5000000,true);
 assert(v.valid&&v.sent==100&&v.received==95&&v.lost==5&&v.lossPercent==5&&v.pending==0);
 assert(!strcmp(v.text,"Получено 95 из 100\nПотери 5 (5,0%)"));
 assert(en_stats_read(1,5000000,true).sent==0);
 // No response does not imply all outstanding requests were lost.
 for(unsigned i=0;i<10;i++){en_stats_prepare(0,request);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)request,24,report));}
 v=en_stats_read(0,5000000,true);assert(v.sent==100&&v.lost==5&&v.pending==10);
 en_stats_response(0,42,(uint8_t*)report,33);v=en_stats_read(0,5000000,true);
 assert(v.sent==110&&v.received==105&&v.lost==5&&v.pending==0);
 // Local queue rejection is counted separately, never as a transmitted packet.
 en_stats_prepare(0,request);en_stats_sent(0,false);assert(en_stats_read(0,5000000,true).sendErrors==1&&en_stats_tx[0].sent==110);
 en_stats_prepare(0,request);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)request,24,report));en_stats_response(0,42,(uint8_t*)report,33);
 assert(en_stats_read(0,5000000,true).lost==5);
 // Timeout invalidates the display, while retaining the last reconciled history.
 now_us+=5000000;v=en_stats_read(0,5000000,true);assert(!v.valid&&v.lost==5&&!strcmp(v.text,"Нет свежего отчета"));
 assert(!en_stats_read(0,5000000,false).valid);
 // Receiver reboot invalidates its ledger; restart rather than reporting fictitious losses.
 en_stats_response(0,44,(uint8_t*)report,33);v=en_stats_read(0,5000000,true);assert(!v.valid&&v.sent==0&&v.lost==0&&v.sendErrors==0);
 baseline(0,44);uint64_t session=en_stats_tx[0].session;en_stats_reset(0);assert(en_stats_tx[0].session!=session&&en_stats_tx[1].receiver_boot==43);
 assert(!en_stats_read(99,5000000,true).valid);
 return 0;
}
`,'clex-espnow-statistics-');
});
test('packet numbering handles reordering, duplicates, long gaps, old sessions and rollover',()=>{
 runHostC(support+ESPNOW_STATISTICS+String.raw`
int main(void){
 char first[25],second[25],report[34];en_stats_prepare(0,first);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)first,24,report));en_stats_response(0,42,(uint8_t*)report,33);
 en_stats_prepare(0,first);en_stats_sent(0,true);en_stats_prepare(0,second);en_stats_sent(0,true);
 assert(en_stats_request(0,(uint8_t*)second,24,report));assert(!en_stats_request(0,(uint8_t*)first,24,report));
 assert(en_stats_request(0,(uint8_t*)second,24,report));en_stats_response(0,42,(uint8_t*)report,33);
 en_stats_snapshot_t v=en_stats_read(0,5000000,true);assert(v.sent==2&&v.received==2&&v.lost==0);
 // Gap beyond the bounded duplicate window, then replay of a long-expired packet.
 en_stats_tx[0].sent=1000;en_stats_prepare(0,second);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)second,24,report));
 assert(!en_stats_request(0,(uint8_t*)first,24,report));assert(en_stats_rx[0].received==3);
 en_stats_response(0,42,(uint8_t*)report,33);v=en_stats_read(0,5000000,true);assert(v.sent==1001&&v.received==3&&v.lost==998);
 // Malformed/foreign reports cannot replace the latest reconciled snapshot.
 report[0]='z';en_stats_response(0,42,(uint8_t*)report,33);assert(en_stats_tx[0].measured==1001);
 assert(!en_stats_request(0,(uint8_t*)second,23,report));
 uint64_t session=en_stats_tx[0].session;en_stats_reset(0);
 en_stats_prepare(0,first);assert(en_stats_request(0,(uint8_t*)first,24,report));en_stats_sent(0,true);en_stats_response(0,42,(uint8_t*)report,33);
 assert(en_stats_request(0,(uint8_t*)second,24,report)&&report[32]=='1');
 assert(en_stats_tx[0].session!=session&&en_stats_tx[0].sent==0);
 en_stats_tx[0].sent=UINT32_MAX;session=en_stats_tx[0].session;en_stats_prepare(0,first);assert(en_stats_tx[0].session!=session&&en_stats_tx[0].sent==0);
 return 0;
}
`,'clex-espnow-statistics-order-');
});
test('monitor exposes loss metrics and a reset event that generates a real reset call',()=>{
 let {project,nodes}=espNowProject({receiver:false,peerHealth:true});
 const monitor=nodes.peer;
 const ports=nodePorts(monitor,catalog,project);
 for(const id of ['testSent','testReceived','testLost','lossPercent','statisticsValid','statisticsText','pendingPackets','testSendErrors'])assert.ok(ports.outputs.some(p=>p.id===id));
 project=withLogic(project,connectNodes(project.logic,catalog,{source:nodes.senderMode.id,sourceHandle:'done',target:monitor.id,targetHandle:'resetStatistics'},project));
 assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[]);
 const bundle=generateFirmware(project,catalog),i=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).findIndex(n=>n.id===monitor.id);
 assert.match(bundle.mainC,new RegExp(`static void node_${i}_resetStatistics\\(void\\) __attribute__`));
 assert.match(bundle.mainC,new RegExp(`node_${i}_resetStatistics\\(\\);`));
 assert.match(bundle.mainC,new RegExp(`static void node_${i}_resetStatistics\\(void\\)\\{clex_en_reset_statistics\\(0\\);`));
 assert.match(bundle.mainC,/stats\.valid/);assert.doesNotMatch(bundle.mainC,/@[A-Z_]+@/);
});
test('an unavailable receiver ledger explicitly restarts measurement instead of inventing delivery counts',()=>{
 runHostC(support+ESPNOW_STATISTICS+String.raw`
int main(void){
 char old[25],request[25],report[34];en_stats_prepare(0,old);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)old,24,report));en_stats_response(0,42,(uint8_t*)report,33);
 en_stats_reset(0);en_stats_prepare(0,request);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)request,24,report));en_stats_response(0,42,(uint8_t*)report,33);
 // A delayed baseline from an obsolete session can no longer silently corrupt the result.
 assert(en_stats_request(0,(uint8_t*)old,24,report));
 en_stats_prepare(0,request);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)request,24,report)&&report[32]=='1');
 en_stats_response(0,42,(uint8_t*)report,33);assert(!en_stats_tx[0].receiver_boot&&en_stats_tx[0].sent==0);
 en_stats_prepare(0,request);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)request,24,report));en_stats_response(0,42,(uint8_t*)report,33);
 en_stats_prepare(0,request);en_stats_sent(0,true);assert(en_stats_request(0,(uint8_t*)request,24,report));en_stats_response(0,42,(uint8_t*)report,33);
 assert(en_stats_read(0,5000000,true).valid&&en_stats_read(0,5000000,true).sent==1&&en_stats_read(0,5000000,true).lost==0);
 return 0;
}
`,'clex-espnow-statistics-reset-');
});
