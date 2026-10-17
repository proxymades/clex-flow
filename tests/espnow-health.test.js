import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostC} from './host-c.js';
import {catalog} from './catalog-fixture.js';
import {espNowProject} from './espnow-fixture.js';
import {addNode,updateNode,withLogic,nodePorts,validateGraph} from '../src/logic/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {ESPNOW_HEALTH} from '../src/firmware/drivers/esp-idf/espnow-health.js';

function watchedProject(){
 const {project:p,component}=espNowProject();
 let graph=addNode(p.logic,catalog.modules.find(m=>m.id==='clex.logic.espnow-control'),p.components,p,catalog);
 const id=graph.nodes.at(-1).id;
 graph=updateNode(graph,id,{parameters:{componentId:component.id,action:'peer',mode:'normal',peerId:JSON.parse(component.parameters.peers)[0].id}},catalog,p);
 return {project:withLogic(p,graph),node:graph.nodes.at(-1)};
}
test('old radio blocks stay valid and selecting peer monitoring fills its new settings',()=>{
 const {project}=espNowProject();
 for(const node of project.logic.nodes){delete node.parameters.peerId;if(node.moduleId!=='clex.logic.espnow-send'){delete node.parameters.probeIntervalMs;delete node.parameters.offlineTimeoutMs;}}
 assert.deepEqual(validateGraph(project,catalog).filter(i=>i.severity==='error'),[]);
 const watched=watchedProject();assert.equal(watched.node.parameters.probeIntervalMs,1000);assert.equal(watched.node.parameters.offlineTimeoutMs,5000);
 assert.deepEqual(parseProject(serializeProject(watched.project)),watched.project);
 const ports=nodePorts(watched.node,catalog,watched.project);
 assert.deepEqual(ports.inputs.map(p=>p.id),['resetStatistics']);assert.ok(ports.outputs.some(p=>p.id==='peerState'&&p.valueStates));
 assert.equal(ports.outputs.some(p=>p.id==='ready'),false);
 assert.deepEqual(validateGraph(watched.project,catalog).filter(i=>i.severity==='error'),[]);
});
test('monitors select a real peer, require enough response time and retain their event root',()=>{
 const {project,node}=watchedProject();
 node.parameters.peerId='';assert.ok(validateGraph(project,catalog).some(i=>i.message.includes('Выберите удаленное устройство')));
 node.parameters.peerId=JSON.parse(project.components[0].parameters.peers)[0].id;
 node.parameters.offlineTimeoutMs=1500;assert.ok(validateGraph(project,catalog).some(i=>i.message.includes('трех периодов')));
 node.parameters.offlineTimeoutMs=5000;node.parameters.probeIntervalMs=500.5;
 assert.ok(validateGraph(project,catalog).some(i=>i.code==='logic-parameter'));
});
test('two monitors can share one peer without duplicate probes and keep separate timeout views',()=>{
 let {project,node}=watchedProject();
 const copy={...structuredClone(node),id:crypto.randomUUID(),name:'Другая индикация'};copy.parameters.probeIntervalMs=2000;copy.parameters.offlineTimeoutMs=10000;
 project=withLogic(project,{...project.logic,nodes:[...project.logic.nodes,copy]});
 const source=generateFirmware(project,catalog).mainC;
 assert.match(source,/en_probe_intervals\[EN_PEER_COUNT\?EN_PEER_COUNT:1\]=\{1000000\}/);
 assert.match(source,/clex_en_peer_read\(0,5000\)/);assert.match(source,/clex_en_peer_read\(0,10000\)/);
 assert.doesNotMatch(source,/@[A-Z_]+@/);
});
test('peer status events cannot acknowledge an unrelated application command',()=>{
 let {project,node}=watchedProject();
 const ack=project.logic.nodes.find(n=>n.moduleId==='clex.logic.espnow-ack');
 project=withLogic(project,{...project.logic,edges:[...project.logic.edges,{id:crypto.randomUUID(),source:node.id,sourceHandle:'peerChanged',target:ack.id,targetHandle:'trigger',dataType:'event'}]});
 assert.ok(validateGraph(project,catalog).some(i=>i.message.includes('непосредственную обработку')));
});

const support=String.raw`
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#define EN_PEER_COUNT 2
#define EN_TIMEOUT_US 1000000LL
enum {EN_PING=6,EN_PONG=7,EN_PEER=6};
static struct {bool ready;} clex_en_status={true};
static unsigned en_count(void){return EN_PEER_COUNT;}
static const uint64_t en_boot=42;
static int64_t now_us;
static int64_t esp_timer_get_time(void){return now_us;}
static uint64_t en_random(void){static uint64_t value=100;return ++value;}
static unsigned probes,replies,events;
static bool en_packet(unsigned peer,uint8_t kind,uint8_t result,uint64_t source,uint64_t dest,uint32_t seq,const char*command,const char*text){
 (void)peer;(void)result;(void)source;(void)dest;(void)seq;(void)command;(void)text;
 if(kind==EN_PING){probes++;}else{replies++;}return true;
}
static void clex_en_notify(unsigned kind,unsigned peer){assert(kind==EN_PEER&&peer<2);events++;}
`;
test('generated C health logic expires exactly at timeout and never replaces unknown RSSI with an old sample',()=>{
 const checks=String.raw`
int main(void){
 clex_en_peer_snapshot_t v=clex_en_peer_read(0,5000);assert(v.peerState==0&&!v.online&&v.lastSeenSeconds==-1);
 en_health_poll();assert(probes==1&&events==2&&en_health[0].pending);
 uint64_t nonce=en_health[0].nonce;uint32_t seq=en_health[0].seq;
 en_health_handle(0,EN_PONG,11,nonce+1,seq,-62,NULL,0);assert(!en_health[0].seen);
 en_health_handle(0,EN_PONG,11,nonce,seq+1,-62,NULL,0);assert(!en_health[0].seen);
 en_health_handle(0,EN_PONG,11,nonce,seq,-62,NULL,0);v=clex_en_peer_read(0,5000);assert(v.online&&v.rssiValid&&v.rssi==-62&&v.lastSeenSeconds==0);
 now_us=100000;en_health_handle(0,EN_PONG,11,nonce,seq,-40,NULL,0);assert(en_health[0].reply_at==0);
 now_us=4999999;assert(clex_en_peer_read(0,5000).online);
 now_us=5000000;v=clex_en_peer_read(0,5000);assert(v.peerState==2&&!v.online&&!v.rssiValid&&v.rssi==0&&!strcmp(v.rssiText,"--")&&v.lastSeenSeconds==5);
 assert(clex_en_peer_read(1,5000).peerState==2);en_health_reply(0,-127);v=clex_en_peer_read(0,5000);assert(v.online&&!v.rssiValid&&v.rssi==0);
 en_health_handle(1,EN_PING,8,0,3,-55,NULL,0);assert(replies==1&&!en_health[1].seen);
 en_health_handle(1,EN_PING,8,0,3,-55,NULL,0);assert(replies==1);
 clex_en_status.ready=false;v=clex_en_peer_read(0,5000);assert(v.peerState==3&&!v.online&&!v.rssiValid&&v.rssi==0);
 assert(clex_en_peer_read(20,5000).peerState==3);
 clex_en_status.ready=true;en_health[0].pending=true;en_health[0].nonce=123;en_health[0].seq=9;en_health[0].probe_at=now_us-EN_TIMEOUT_US;
 int64_t before=en_health[0].reply_at;en_health_handle(0,EN_PONG,11,123,9,-70,NULL,0);assert(en_health[0].reply_at==before);
 return 0;
}
`;
 runHostC(support+ESPNOW_HEALTH.replace('@HEALTH_INTERVALS@','{1000000,1000000}')+checks,'clex-peer-health-');
});
test('old projects without a monitor do not start sending background checks',()=>{
 runHostC(support+ESPNOW_HEALTH.replace('@HEALTH_INTERVALS@','{0,0}')+String.raw`
int main(void){en_health_poll();assert(probes==0);now_us=9000000;en_health_poll();assert(probes==0);en_health_handle(0,EN_PING,10,0,1,-60,NULL,0);assert(replies==1);assert(clex_en_peer_read(0,5000).peerState==2);return 0;}
`,'clex-peer-disabled-');
});
