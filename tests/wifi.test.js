import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {wifiProject} from './wifi-fixture.js';
import {wifiSupported,wifiIssues} from '../src/wifi/model.js';
import {addHardware,validateAssembly,removeHardware} from '../src/assembly/model.js';
import {addNode,withLogic,validateGraph,hardwareBinding,connectNodes} from '../src/logic/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
import {createProject,serializeProject,parseProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {mqttNetwork,mqttIssues} from '../src/mqtt/model.js';
import {resourceClaims} from '../src/hardware/resources.js';
const boards=['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano'];
const definition=id=>catalog.modules.find(module=>module.id===id);
const errors=project=>[...validateAssembly(project,catalog),...validateGraph(project,catalog)].filter(issue=>issue.severity==='error');
test('Wi-Fi Station generates on every compatible current board without router services or a mandatory logic block',()=>{
 for(const board of catalog.boards){
  assert.equal(wifiSupported(board),boards.includes(board.id));
  for(const id of ['clex.hardware.wifi','clex.logic.wifi'])assert.equal(moduleSupportsBoard(definition(id),board),boards.includes(board.id));
 }
 for(const boardId of boards)for(const logic of [false,true]){
  const {project,wifi,node}=wifiProject({boardId,logic});
  assert.deepEqual(errors(project),[]);assert.deepEqual(wifiIssues(wifi,project,catalog),[]);
  assert.deepEqual(parseProject(serializeProject(project)),project);
  if(node)assert.equal(hardwareBinding(node,project,catalog).error,null);
  const bundle=generateFirmware(project,catalog);
  assert.match(bundle.mainC,/esp_wifi_set_mode\(WIFI_MODE_STA\)/);
  assert.doesNotMatch(bundle.mainC,/esp_netif_create_default_wifi_ap|WIFI_MODE_APSTA|esp_netif_napt|httpd_start|dhcps_start/);
  assert.doesNotMatch(bundle.mainC,/@[A-Z_]+@/);
  assert.ok(bundle.featureRuntimes.includes('wifi-sta-'+bundle.target));
  assert.ok(bundle.files['partitions.csv']);
  if(boardId.includes('p4')){
   assert.ok(bundle.featureRuntimes.includes('wifi-hosted-p4'));
   assert.match(bundle.files['main/idf_component.yml'],/esp_hosted: "=2\.12\.3"/);
   assert.match(bundle.files['sdkconfig.defaults'],/CONFIG_ESP_HOSTED_PRIV_SDIO_PIN_CMD_SLOT_1=19/);
   assert.deepEqual(resourceClaims(project,catalog).find(claim=>claim.componentId===wifi.id).gpios,[19,18,14,15,16,17,54]);
  }
 }
 assert.throws(()=>wifiProject({boardId:'arduino-nano-atmega328p-ch340'}),/Wi-Fi/);
});
test('Wi-Fi rejects invalid UTF-8, byte limits, timing and IPv4 while supporting open networks and static addresses',()=>{
 const {project,wifi}=wifiProject({staticIp:true});const baseline={...wifi.parameters};
 assert.deepEqual(wifiIssues(wifi,project,catalog),[]);
 for(const patch of [{ssid:''},{ssid:'я'.repeat(17)},{ssid:'a\0b'},{ssid:'\ud800'},{password:'short'},{password:'я'.repeat(32)},{password:'abc\0defghi'},{autoConnect:'true'},{autoReconnect:null},{reconnectMs:0},{connectTimeoutMs:1},{staticIp:'192.0.2.0'},{netmask:'255.0.255.0'},{gateway:'198.51.100.1'},{dns:'invalid'}]){
  wifi.parameters={...baseline,...patch};assert.ok(wifiIssues(wifi,project,catalog).length,JSON.stringify(patch));assert.throws(()=>generateFirmware(project,catalog));
 }
 wifi.parameters={...baseline,password:''};assert.deepEqual(wifiIssues(wifi,project,catalog),[]);
 assert.match(generateFirmware(project,catalog).mainC,/threshold.authmode=WIFI_AUTH_OPEN/);
 wifi.parameters={...baseline,ssid:'я'.repeat(16)};assert.deepEqual(wifiIssues(wifi,project,catalog),[]);
 for(const boardId of boards){
  const {project}=wifiProject({boardId,staticIp:true});assert.deepEqual(errors(project),[]);
  const bundle=generateFirmware(project,catalog);assert.match(bundle.mainC,/esp_netif_dhcpc_stop\(clex_wifi_netif\)/);assert.match(bundle.mainC,/esp_netif_set_dns_info\(clex_wifi_netif/);
 }
});
test('Wi-Fi owns a single radio and imported projects cannot bypass conflicts with router or ESP-NOW',()=>{
 const {project}=wifiProject();
 for(const id of ['clex.hardware.wifi','clex.hardware.router','clex.hardware.espnow'])assert.throws(()=>addHardware(project,definition(id),catalog),/Радио/);
 for(const id of ['clex.hardware.router','clex.hardware.espnow']){
  const fresh=addHardware(createProject('Radio','',project.boardId,{camera:'disconnected'}),definition(id),catalog);
  assert.throws(()=>addHardware(fresh,definition('clex.hardware.wifi'),catalog),/Радио/);
  const imported=structuredClone(project);imported.components.push(fresh.components[0]);imported.moduleVersions[id]=fresh.components[0].moduleVersion;
  assert.ok(errors(imported).some(issue=>issue.code==='wifi-config'));
 }
 const duplicate=structuredClone(project);duplicate.components.push({...structuredClone(project.components[0]),id:crypto.randomUUID()});assert.ok(errors(duplicate).some(issue=>issue.message.includes('одно Wi-Fi')));
 const removed=removeHardware(project,catalog,project.components[0].id);assert.ok(errors(removed).some(issue=>issue.code==='logic-hardware'));
});
test('MQTT binds to Wi-Fi Station on all boards and HTTP probes use it as an available network',()=>{
 for(const boardId of boards){
  let {project,wifi}=wifiProject({boardId,mqtt:true,logic:false});const mqtt=project.components.find(c=>c.moduleId==='clex.hardware.mqtt');
  assert.equal(mqttNetwork(mqtt,project,catalog).id,wifi.id);assert.deepEqual(mqttIssues(mqtt,project,catalog),[]);
  const bundle=generateFirmware(project,catalog);assert.match(bundle.mainC,/\.if_key="WIFI_STA_DEF"/);assert.match(bundle.mainC,/\.router=false/);
  project=withLogic(project,addNode(project.logic,definition('clex.logic.internet-check'),project.components,project,catalog));
  project.logic.nodes.at(-1).parameters.url='https://example.org/';
  assert.deepEqual(errors(project),[]);assert.match(generateFirmware(project,catalog).mainC,/clex_network_changed\(\);/);
 }
});
test('Wi-Fi status and manual controls use normal typed graph connections and do not require automatic connection',()=>{
 let {project,node}=wifiProject({autoConnect:false});
 project=withLogic(project,addNode(project.logic,definition('clex.logic.timer'),project.components,project,catalog));const timer=project.logic.nodes.at(-1);
 project=withLogic(project,connectNodes(project.logic,catalog,{source:timer.id,sourceHandle:'tick',target:node.id,targetHandle:'connect'},project));
 assert.deepEqual(errors(project),[]);const bundle=generateFirmware(project,catalog);
 assert.match(bundle.mainC,/clex_wifi_control=\{\.wanted=false\}/);
 assert.match(bundle.mainC,/clex_wifi_request\(WF_CONNECT\)/);
 assert.match(bundle.mainC,/node_\d+_connect\(\);/);
});

test('Wi-Fi and Ethernet keep independent MQTT interface bindings on boards with both adapters',()=>{
 for(const boardId of ['waveshare-esp32-s3-eth','waveshare-esp32-p4-nano']){
  let {project,wifi}=wifiProject({boardId,mqtt:true});
  project=addHardware(project,definition('clex.hardware.ethernet'),catalog);const ethernet=project.components.at(-1);
  project=addHardware(project,definition('clex.hardware.mqtt'),catalog);const mqtt=project.components.at(-1);
  Object.assign(mqtt.parameters,{host:'second.example.test',networkId:ethernet.id});
  assert.equal(mqttNetwork(mqtt,project,catalog).id,ethernet.id);
  assert.equal(mqttNetwork(project.components.find(c=>c.moduleId==='clex.hardware.mqtt'),project,catalog).id,wifi.id);
  assert.deepEqual(errors(project),[]);const bundle=generateFirmware(project,catalog);
  assert.ok(bundle.mainC.includes('.if_key="'+ethernet.id+'"'));assert.match(bundle.mainC,/\.if_key="WIFI_STA_DEF"/);
 }
});
