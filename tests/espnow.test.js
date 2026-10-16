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

test('four ESP-NOW types expose only their active ports and enforce actual block versions',()=>{
 const modules=catalog.modules.filter(m=>m.kind==='logic'&&m.id.startsWith('clex.logic.espnow-'));
 assert.deepEqual(modules.map(m=>m.id).sort(),['clex.logic.espnow-ack','clex.logic.espnow-control','clex.logic.espnow-receive','clex.logic.espnow-send']);
 for(const module of modules){
  assert.equal(module.version,'2.0.0');
  const {project:p}=espNowProject({combined:true}),node=p.logic.nodes.find(n=>n.moduleId===module.id);
  assert.equal(node.moduleVersion,'2.0.0');node.moduleVersion='1.0.0';
  assert.ok(validateGraph(p,catalog).some(i=>i.code==='logic-module'&&i.nodeId===node.id));assert.throws(()=>generateFirmware(p,catalog));
 }
});
test('send mode changes preserve payload and trigger connections but remove completed-command connections',async()=>{
 const{nodePorts,updateNode,connectNodes,withLogic}=await import('../src/logic/model.js');let{project:p,nodes}=espNowProject({receiver:false});
 p.logic.edges=p.logic.edges.filter(e=>e.target!==nodes.send.id);
 p=withLogic(p,connectNodes(p.logic,catalog,{source:nodes.message.id,sourceHandle:'messageReceived',target:nodes.send.id,targetHandle:'trigger'},p));
 p=withLogic(p,connectNodes(p.logic,catalog,{source:nodes.message.id,sourceHandle:'text',target:nodes.send.id,targetHandle:'text'},p));
 const send=p.logic.nodes.find(n=>n.id===nodes.send.id),before=structuredClone(p.logic);
 const changed=updateNode(p.logic,send.id,{parameters:{...send.parameters,transferType:'message'}},catalog,p);
 assert.equal(changed.edges.length,before.edges.length-1);assert.ok(changed.edges.some(e=>e.target===send.id&&e.targetHandle==='text'));assert.ok(changed.edges.some(e=>e.target===send.id&&e.targetHandle==='trigger'));assert.ok(!changed.edges.some(e=>e.source===send.id&&e.sourceHandle==='completed'));
 assert.deepEqual(nodePorts(changed.nodes.find(n=>n.id===send.id),catalog,p).outputs.map(p=>p.id),['accepted','failed','error']);assert.deepEqual(p.logic,before);
});
test('receive changes remove command execution links while preserving text and sender purposes',async()=>{
 const{nodePorts,updateNode}=await import('../src/logic/model.js');const{project:p,nodes}=espNowProject();
 const graph={...p.logic,edges:[...p.logic.edges,{id:crypto.randomUUID(),source:nodes.command.id,sourceHandle:'text',target:nodes.serial.id,targetHandle:'text',dataType:'text'},{id:crypto.randomUUID(),source:nodes.command.id,sourceHandle:'command',target:nodes.serial.id,targetHandle:'text',dataType:'text'}]};
 const changed=updateNode(graph,nodes.command.id,{parameters:{...nodes.command.parameters,transferType:'message'}},catalog,p);
 assert.ok(!changed.edges.some(e=>e.source===nodes.command.id&&['commandReceived','command'].includes(e.sourceHandle)));assert.ok(changed.edges.some(e=>e.source===nodes.command.id&&e.sourceHandle==='text'));
 const ports=nodePorts(changed.nodes.find(n=>n.id===nodes.command.id),catalog,p);assert.equal(ports.outputs.find(p=>p.id==='text').readyOn,'messageReceived');assert.equal(ports.outputs.some(p=>p.id==='command'),false);
});
test('control action changes prune state connections and Undo restores the exact graph',async()=>{
 const{nodePorts,updateNode}=await import('../src/logic/model.js');const{createHistory}=await import('../src/logic/history.js');const{project:p,nodes}=espNowProject();
 const history=createHistory(p.logic),before=structuredClone(p.logic);history.change(g=>updateNode(g,nodes.status.id,{parameters:{...nodes.status.parameters,action:'mode'}},catalog,p));
 assert.ok(!history.current.edges.some(e=>e.source===nodes.status.id));assert.deepEqual(nodePorts(history.current.nodes.find(n=>n.id===nodes.status.id),catalog,p).outputs.map(p=>p.id),['done','failed','error']);assert.deepEqual(history.undo(),before);assert.ok(history.redo().nodes.find(n=>n.id===nodes.status.id).parameters.action==='mode');
});
test('four-block projects preserve parameters, identities, keys and wiring through import/export',()=>{
 const{project:p}=espNowProject({combined:true});assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);assert.deepEqual(parseProject(serializeProject(p)),p);generateFirmware(p,catalog);
});
test('message and command modes generate separate acknowledgements without changing the radio driver',()=>{
 const{project:p,nodes}=espNowProject({receiver:false});let bundle=generateFirmware(p,catalog);assert.match(bundle.mainC,/_emit_completed/);
 p.logic.nodes=p.logic.nodes.filter(n=>n.id!==nodes.senderMode.id);p.logic.edges=p.logic.edges.filter(e=>e.source!==nodes.send.id&&e.target!==nodes.senderMode.id);const send=p.logic.nodes.find(n=>n.id===nodes.send.id);send.parameters.transferType='message';send.parameters.command='ignored';send.parameters.message='Привет, мир!';bundle=generateFirmware(p,catalog);assert.match(bundle.mainC,/_emit_accepted/);assert.match(bundle.mainC,/clex_en_send\([^,]+,[^,]+,false,"",/);
 const peers=JSON.parse(p.components[0].parameters.peers);peers[0].encrypted=false;p.components[0].parameters.peers=JSON.stringify(peers);assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);bundle=generateFirmware(p,catalog);assert.match(bundle.mainC,/\.encrypted=false/);
 send.parameters.transferType='command';assert.ok(validateGraph(p,catalog).some(i=>i.message.includes('зашифрованного')));
});

test('ESP-NOW hardware and all four logic modules share version 2.0.0 throughout projects and examples',async()=>{
 const modules=catalog.modules.filter(m=>m.id==='clex.hardware.espnow'||m.id.startsWith('clex.logic.espnow-'));
 assert.equal(modules.length,5);for(const module of modules)assert.equal(module.version,'2.0.0',module.id);
 const {project:p,component}=espNowProject({combined:true});
 for(const element of [...p.components,...p.logic.nodes].filter(n=>modules.some(m=>m.id===n.moduleId))){assert.equal(element.moduleVersion,'2.0.0');assert.equal(p.moduleVersions[element.moduleId],'2.0.0');}
 generateFirmware(parseProject(serializeProject(p)),catalog);
 component.moduleVersion='1.0.0';p.moduleVersions[component.moduleId]='1.0.0';
 assert.ok(validateAssembly(p,catalog).some(i=>i.severity==='error'));assert.throws(()=>generateFirmware(p,catalog));
 const {readFile}=await import('node:fs/promises');
 for(const name of ['receiver','button']){
  const example=parseProject(await readFile(new URL('../examples/espnow-'+name+'.clex.json',import.meta.url),'utf8'));
  for(const element of [...example.components,...example.logic.nodes].filter(n=>modules.some(m=>m.id===n.moduleId))){assert.equal(element.moduleVersion,'2.0.0');assert.equal(example.moduleVersions[element.moduleId],'2.0.0');}
 }
});
