import test from 'node:test';
import assert from 'node:assert/strict';
import {routerProject} from './router-fixture.js';
import {catalog} from './catalog-fixture.js';
import {routerIssues,overlap} from '../src/router/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {addHardware} from '../src/assembly/model.js';
import {displayProject} from './display-fixture.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';

test('router modes on every existing compatible board generate real NAT, DHCP, DNS, authenticated management and OTA',()=>{
 for(const boardId of ['waveshare-esp32-s3-eth','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-p4-nano'])for(const mode of [{},{wan:'ethernet'},{lan:'ethernet'},{wan:'ethernet',backup:'wifi'}]){
  if(boardId.includes('devkit')&&Object.keys(mode).length)continue;
  const {project,router}=routerProject({boardId,...mode});assert.deepEqual(routerIssues(router,project,catalog),[]);assert.deepEqual(parseProject(serializeProject(project)),project);
  const b=generateFirmware(project,catalog);assert.match(b.mainC,/esp_netif_napt_enable/);assert.match(b.mainC,/esp_netif_dhcps_option/);assert.match(b.mainC,/esp_netif_set_default_netif/);assert.match(b.mainC,/esp_ota_set_boot_partition/);assert.match(b.mainC,/WWW-Authenticate/);assert.match(b.mainC,/Origin rejected/);assert.doesNotMatch(b.mainC,/@[A-Z_]+@/);assert.match(b.files['partitions.csv'],/ota_1/);assert.match(b.files['sdkconfig.defaults'],/CONFIG_LWIP_IPV4_NAPT=y/);
  if(boardId.includes('p4')){assert.match(b.files['main/idf_component.yml'],/esp_hosted/);assert.equal(router.parameters.apAuth,'wpa2');}
 }
});
test('router prevents conflicting interfaces, invalid DHCP, overlaps, bad UTF-8 credentials and invalid port forwards',()=>{
 const {project,router}=routerProject({wan:'ethernet'});const p=router.parameters;
 p.lanSource='ethernet';assert.ok(routerIssues(router,project,catalog).some(s=>s.includes('одновременно')));p.lanSource='softap';
 p.dhcpStart=p.lanIp;assert.ok(routerIssues(router,project,catalog).some(s=>s.includes('Диапазон')));p.dhcpStart='192.168.50.10';
 const eth=project.components[0];Object.assign(eth.parameters,{addressMode:'static',staticIp:'192.168.50.5',netmask:'255.255.255.0',gateway:'192.168.50.2'});assert.ok(routerIssues(router,project,catalog).some(s=>s.includes('пересекаются')));eth.parameters.addressMode='dhcp';
 p.apSsid='я'.repeat(17);assert.ok(routerIssues(router,project,catalog).some(s=>s.includes('SSID')));p.apSsid='LAN';
 p.portMappings=JSON.stringify([{protocol:'tcp',externalPort:80,internalPort:80,host:'192.168.10.3'}]);assert.ok(routerIssues(router,project,catalog).some(s=>s.includes('проброса')));
 assert.equal(overlap('192.168.0.2','255.255.0.0','192.168.50.1','255.255.255.0'),true);assert.equal(overlap('10.0.0.2','255.0.0.0','192.168.50.1','255.255.255.0'),false);
});
test('router without OTA keeps one factory partition and does not claim an update slot',()=>{
 const {project}=routerProject({ota:false});const bundle=generateFirmware(project,catalog);assert.match(bundle.files['partitions.csv'],/factory,app,factory/);assert.doesNotMatch(bundle.files['partitions.csv'],/ota_1/);assert.equal(bundle.featureRuntimes.some(f=>f.startsWith('router-ota-')),false);
});
test('router settings use unique generated passwords and radio conflicts are explicit',()=>{
 const module=catalog.modules.find(m=>m.id==='clex.hardware.router');let {project,router}=routerProject();
 assert.throws(()=>addHardware(project,module,catalog),/уже/);
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.espnow'),catalog);assert.ok(routerIssues(router,project,catalog).some(s=>s.includes('ESP-NOW')));
 const other=routerProject().project;other.components.pop();other.moduleVersions={};other.logic.nodes=[];other.logic.edges=[];
 const one=addHardware(other,module,catalog).components.at(-1),two=addHardware(other,module,catalog).components.at(-1);assert.notEqual(one.parameters.apPassword,two.parameters.apPassword);assert.notEqual(one.parameters.adminPassword,two.parameters.adminPassword);
});
test('router WAN IP and client count use ordinary display bindings, alongside existing Ethernet and internet-check blocks',()=>{
 let project=displayProject();
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.ethernet'),catalog);
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.router'),catalog);project.components.at(-1).parameters.wanSource='ethernet';
 project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.router'),project.components,project,catalog));const source=project.logic.nodes.at(-1),view=project.logic.nodes.find(n=>n.moduleId==='clex.logic.display'),screen=project.screens[project.components[0].id];
 const field=screen.elements[0];Object.assign(field,{mode:'dynamic',valueType:'text',initialValue:'',prefix:'WAN: ',suffix:''});
 for(const [sourceHandle,targetHandle] of [['changed','trigger'],['wanIp',field.id]])project=withLogic(project,connectNodes(project.logic,catalog,{source:source.id,sourceHandle,target:view.id,targetHandle},project));
 const bundle=generateFirmware(project,catalog);assert.match(bundle.mainC,/clex_graphics_set_text\([^\n]*router_value_\d+\.wan_ip/);assert.match(bundle.mainC,/esp_eth_mac_new_w5500/);assert.equal(bundle.graphicsRuntime,'lvgl-9.2.2');
 project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.internet-check'),project.components,project,catalog));project.logic.nodes.at(-1).parameters.url='https://www.espressif.com/';assert.match(generateFirmware(project,catalog).mainC,/clex_probe_start/);
});
