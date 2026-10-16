import test from 'node:test';import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';import{espNowProject}from './espnow-fixture.js';
import {espNowIssues,espNowSupported,macValid,newKey,espNowAckIssues} from '../src/espnow/model.js';
import{serializeProject,parseProject}from '../src/projects/model.js';import{generateFirmware}from '../src/firmware/generator.js';
import{validateAssembly,addHardware}from '../src/assembly/model.js';import{validateGraph}from '../src/logic/model.js';
test('ESP-NOW capability excludes P4 and Nano, and a radio claims no GPIO',()=>{
 for(const b of catalog.boards.filter(b=>['esp32p4','atmega328p'].includes(b.target)))assert.equal(espNowSupported(b),false);
 const {project:p,component:c}=espNowProject();assert.deepEqual(p.assembly.connections,[]);assert.deepEqual(p.gpioAssignments,[]);assert.equal(espNowSupported(catalog.boards.find(b=>b.id===p.boardId)),true);assert.throws(()=>addHardware(p,catalog.modules.find(m=>m.id===c.moduleId),catalog),/уже добавлен/);
});
test('ESP-NOW validates channels, keys and trusted unicast peers and preserves settings',()=>{
 const{project:p,component:c}=espNowProject();assert.equal(newKey().length,32);assert.deepEqual(parseProject(serializeProject(p)),p);assert.equal(macValid('FF:FF:FF:FF:FF:FF'),false);assert.equal(macValid('00:00:00:00:00:00'),false);
 const b=catalog.boards.find(b=>b.id===p.boardId);assert.deepEqual(espNowIssues(c,b),[]);c.parameters.pmk='bad';assert.ok(espNowIssues(c,b).some(i=>i.includes('PMK')));c.parameters.channel=0;assert.ok(espNowIssues(c,b).some(i=>i.includes('канал')));
});
test('ESP-NOW emits real IDF APIs, authenticated sessions, queue-only receive and per-peer PHY',()=>{
 for(const options of [{zeroPeers:true},{},{receiver:false},{combined:true}]){
 const{project:p}=espNowProject(options);assert.deepEqual([...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(i=>i.severity==='error'),[]);
 const b=generateFirmware(p,catalog);assert.deepEqual(b.featureRuntimes,['espnow-s3']);assert.match(b.mainC,/esp_now_set_peer_rate_config/);assert.match(b.mainC,/WIFI_PHY_RATE_LORA_250K/);assert.match(b.mainC,/mbedtls_md_hmac/);assert.match(b.mainC,/xQueueSend\(en_raw_queue/);assert.doesNotMatch(b.mainC,/@[A-Z_]+@/);assert.match(b.files['main/CMakeLists.txt'],/esp_wifi.*mbedtls/);
 }
});
test('command execution requires encryption, one handler, and a synchronous command ACK path',()=>{
 const{project:p,nodes,component}=espNowProject();assert.deepEqual(espNowAckIssues(nodes.ack,p,catalog),[]);component.parameters.encryption=false;
 const send=espNowProject({receiver:false});send.component.parameters.encryption=false;assert.ok(validateGraph(send.project,catalog).some(i=>i.message.includes('зашифрованного')));
 p.logic.edges=p.logic.edges.filter(e=>e.target!==nodes.ack.id);assert.ok(validateGraph(p,catalog).some(i=>i.message.includes('Подтвердить')));
});
test('button sender uses a generic debounced GPIO edge and stable manual wiring',async()=>{
 const{espNowButtonProject}=await import('./espnow-fixture.js');const{project:p,input}=espNowButtonProject();assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);assert.equal(input.moduleId,'clex.logic.gpio-edge');assert.equal(p.logic.nodes.some(n=>n.moduleId==='clex.logic.timer'),false);const b=generateFirmware(p,catalog);assert.match(b.mainC,/gpio_edge_\d+ != input_stable_/);assert.equal(p.assembly.connections.length,2);
});
test('bad peer JSON remains a validation error and cannot crash the peer editor',async()=>{
 const{readPeers}=await import('../src/espnow/model.js');const {project:p,component:c}=espNowProject();const b=catalog.boards.find(b=>b.id===p.boardId);for(const peers of ['{bad','[null,5,"bad"]','[{"id":null,"name":null,"mac":null}]']){c.parameters.peers=peers;assert.doesNotThrow(()=>readPeers(c));assert.ok(espNowIssues(c,b).length);}
});
