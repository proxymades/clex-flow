import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {catalog} from './catalog-fixture.js';
import {testKey} from './espnow-fixture.js';
import {parseProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
test('all shipped examples generate after filling only deployment-specific connection settings in memory',()=>{
 for(const file of readdirSync(new URL('../examples/',import.meta.url)).filter(f=>f.endsWith('.json'))){
  const path=new URL('../examples/'+file,import.meta.url),raw=readFileSync(path,'utf8'),project=parseProject(raw);
  for(const component of project.components){
   if(component.moduleId==='clex.hardware.router')Object.assign(component.parameters,{staSsid:'Fixture WAN',staPassword:'fixture-wan-key',apPassword:'fixture-lan-key',adminUser:'fixture',adminPassword:'fixture-admin-key'});
   if(component.moduleId==='clex.hardware.espnow'){
    component.parameters.pmk=testKey;
    component.parameters.peers=JSON.stringify(JSON.parse(component.parameters.peers).map((peer,i)=>({...peer,mac:'02:11:22:33:44:'+String(10+i),lmk:testKey})));
   }
  }
  assert.doesNotThrow(()=>generateFirmware(project,catalog),file);
  assert.equal(readFileSync(path,'utf8'),raw);
 }
});

const lampExample=side=>parseProject(readFileSync(new URL('../examples/smart-lamp-'+side+'-s3-eth.clex.json',import.meta.url),'utf8'));
const lampPrefix='clex/examples/smart-lamp/';
test('smart lamp examples route each command through GPIO completion to its own acknowledgement',()=>{
 for(const [side,ack] of [['left','ack1'],['right','ack2']]){
  const p=lampExample(side),nodes=p.logic.nodes,edges=p.logic.edges,byId=new Map(nodes.map(node=>[node.id,node]));
  const receive=nodes.find(node=>node.moduleId==='clex.logic.mqtt-receive'),select=nodes.find(node=>node.moduleId==='clex.logic.select-number');
  assert.equal(nodes.filter(node=>node.moduleId==='clex.logic.mqtt-receive').length,1);
  assert.equal(select.moduleVersion,'2.0.0');assert.equal(select.parameters.valueType,'text');
  assert.deepEqual(JSON.parse(receive.parameters.filters).map(row=>row.topic),[lampPrefix+side+'-lamp/set',lampPrefix+'lamps/set']);
  assert.ok(edges.some(edge=>edge.source===receive.id&&edge.sourceHandle==='received'&&edge.target===select.id&&edge.targetHandle==='trigger'));
  assert.ok(edges.some(edge=>edge.source===receive.id&&edge.sourceHandle==='payload'&&edge.target===select.id&&edge.targetHandle==='value'));
  const rows=JSON.parse(select.parameters.cases),outputs=nodes.filter(node=>node.moduleId==='clex.logic.gpio-set');
  assert.deepEqual(new Set(rows.map(row=>row.value)),new Set(['ON','OFF','GROUP ON','GROUP OFF']));
  assert.equal(outputs.length,2);
  assert.equal(new Set(outputs.map(node=>node.parameters.componentId+'/'+node.parameters.channel)).size,1);
  for(const row of rows){
   const command=edges.filter(edge=>edge.source===select.id&&edge.sourceHandle===row.id);
   assert.equal(command.length,1);
   const output=byId.get(command[0].target);assert.equal(output.moduleId,'clex.logic.gpio-set');
   assert.equal(command[0].targetHandle,row.value.endsWith('OFF')?'off':'on');
   const completed=edges.filter(edge=>edge.source===output.id);
   assert.equal(completed.length,1);assert.equal(completed[0].sourceHandle,'done');assert.equal(completed[0].targetHandle,'trigger');
   const send=byId.get(completed[0].target);assert.equal(send.moduleId,'clex.logic.mqtt-send');
   assert.equal(send.parameters.topic,lampPrefix+(row.value.startsWith('GROUP ')?'lamps/'+ack:side+'-lamp/ack'));
   assert.ok(edges.some(edge=>edge.source===receive.id&&edge.sourceHandle==='payload'&&edge.target===send.id&&edge.targetHandle==='payload'));
   assert.equal(edges.filter(edge=>edge.target===send.id&&edge.targetHandle==='trigger').length,1);
  }
  assert.ok(!edges.some(edge=>edge.source===select.id&&edge.sourceHandle==='other'));
  generateFirmware(p,catalog);
 }
});
test('smart lamp controller group commands match both executor selections',()=>{
 const p=parseProject(readFileSync(new URL('../examples/smart-lamp-controller-p4.clex.json',import.meta.url),'utf8'));
 const groups=p.logic.nodes.filter(node=>node.moduleId==='clex.logic.mqtt-send'&&node.parameters.topic===lampPrefix+'lamps/set');
 assert.deepEqual(new Set(groups.map(node=>node.parameters.payload)),new Set(['GROUP ON','GROUP OFF']));
 for(const side of ['left','right']){
  const select=lampExample(side).logic.nodes.find(node=>node.moduleId==='clex.logic.select-number');
  const values=JSON.parse(select.parameters.cases).map(row=>row.value);
  for(const command of groups)assert.ok(values.includes(command.parameters.payload));
 }
});
test('smart lamp examples contain only demonstration connection settings',()=>{
 const projects=[lampExample('left'),lampExample('right'),parseProject(readFileSync(new URL('../examples/smart-lamp-controller-p4.clex.json',import.meta.url),'utf8'))];
 const clientIds=[];
 for(const p of projects){
  const wifi=p.components.find(component=>component.moduleId==='clex.hardware.wifi').parameters;
  const mqtt=p.components.find(component=>component.moduleId==='clex.hardware.mqtt').parameters;
  assert.equal(wifi.ssid,'YOUR_WIFI');assert.equal(wifi.password,'YOUR_WIFI_PASSWORD');
  assert.equal(wifi.addressMode,'dhcp');assert.equal(wifi.staticIp,'');
  assert.equal(mqtt.host,'broker.example.com');assert.equal(mqtt.username,'YOUR_MQTT_USER');assert.equal(mqtt.password,'YOUR_MQTT_PASSWORD');
  assert.equal(mqtt.caMode,'bundle');assert.equal(mqtt.caPem,'');clientIds.push(mqtt.clientId);
  for(const node of p.logic.nodes.filter(node=>node.moduleId==='clex.logic.mqtt-receive'))for(const filter of JSON.parse(node.parameters.filters))assert.ok(filter.topic.startsWith(lampPrefix));
  for(const node of p.logic.nodes.filter(node=>node.moduleId==='clex.logic.mqtt-send')){
   assert.ok(node.parameters.topic.startsWith(lampPrefix));assert.equal(node.parameters.qos,'1');assert.equal(node.parameters.retain,false);
  }
 }
 assert.equal(new Set(clientIds).size,3);
});
