import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {catalog,timer} from './catalog-fixture.js';
import {mqttProject} from './mqtt-fixture.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
import packages from '../src/firmware/component-files.json' with {type:'json'};
const walk=dir=>readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]);
test('embedded MQTT component matches audited sources and carries its license',()=>{
 const expected=Object.fromEntries(walk('src/firmware/components/mqtt').map(path=>[path.replaceAll('\\','/').replace('src/firmware/',''),readFileSync(path,'utf8')]));
 assert.deepEqual(packages.mqtt.files,expected);
 assert.equal(packages.mqtt.digest,createHash('sha256').update(JSON.stringify(expected)).digest('hex'));
 assert.ok(packages.mqtt.files['components/mqtt/LICENSE']);
});
test('MQTT generates real firmware for both protocols on Wi-Fi and Ethernet boards',()=>{
 for(const boardId of ['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano'])for(const protocol of ['3.1.1','5.0']){
  const network=boardId.startsWith('waveshare')?'ethernet':'wifi';
  const {project}=mqttProject({boardId,network,protocol,clients:2});
  const bundle=generateFirmware(project,catalog);
  assert.ok(bundle.featureRuntimes.includes('mqtt-'+bundle.target));
  assert.match(bundle.mainC,/clex_mq_initialize\(\)/);
  assert.match(bundle.mainC,/clex_mq_poll\(\)/);
  assert.ok(bundle.files['components/mqtt/mqtt_client.c']);
  assert.match(bundle.files['main/CMakeLists.txt'],/\bmqtt\b/);
  assert.match(bundle.files['sdkconfig.defaults'],/CONFIG_MQTT_PROTOCOL_5=y/);
  assert.match(bundle.mainC,new RegExp('source SHA-256: '+packages.mqtt.digest));
 }
});
test('automatic MQTT needs no control or logic block and initializes before graph work',()=>{
 const {project}=mqttProject({nodes:false});const source=generateFirmware(project,catalog).mainC;
 assert.ok(source.indexOf('clex_mq_initialize();')<source.indexOf('atomic_store(&clex_flow_ready, true)'));
 assert.match(source,/atomic_load\(&clex_flow_ready\)/);
});
test('MQTT secondary event inputs compile into distinct commands',()=>{
 let {project,blocks}=mqttProject();
 project=withLogic(project,addNode(project.logic,timer,project.components,project,catalog));const clock=project.logic.nodes.at(-1);
 for(const [node,port]of [[blocks[0].control,'connect'],[blocks[0].control,'disconnect'],[blocks[0].receive,'subscribe'],[blocks[0].receive,'unsubscribe']])project=withLogic(project,connectNodes(project.logic,catalog,{source:clock.id,sourceHandle:'tick',target:node.id,targetHandle:port},project));
 const bundle=generateFirmware(project,catalog),sorted=[...project.logic.nodes].sort((a,b)=>a.id.localeCompare(b.id));
 for(const [node,action]of [[blocks[0].control,'disconnect'],[blocks[0].receive,'unsubscribe']])assert.match(bundle.mainC,new RegExp('node_'+sorted.findIndex(n=>n.id===node.id)+'_'+action+'\\(\\);'));
});
test('MQTT source and fingerprint ignore visual order but include protocol settings',async()=>{
 const {project}=mqttProject({clients:2});const before=generateFirmware(project,catalog),copy=structuredClone(project);
 copy.components.reverse();copy.logic.nodes.reverse();copy.logic.edges.reverse();
 for(const node of copy.logic.nodes)node.position={x:999,y:999};
 const after=generateFirmware(copy,catalog);assert.equal(after.mainC,before.mainC);assert.equal(await firmwareFingerprint(after),await firmwareFingerprint(before));
 copy.components.find(c=>c.moduleId==='clex.hardware.mqtt').parameters.keepAlive=90;
 assert.notEqual(await firmwareFingerprint(generateFirmware(copy,catalog)),await firmwareFingerprint(before));
});
