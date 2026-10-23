import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {createProject,serializeProject,parseProject} from '../src/projects/model.js';
import {addHardware,validateAssembly} from '../src/assembly/model.js';
import {addNode,withLogic,hardwareBinding,logicAdditionProblem,nodePorts} from '../src/logic/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
import {MQTT_MODULE,MQTT_LOGIC_MODULES,mqttTopicValid,mqttPayloadBytes,mqttIssues,mqttLogicIssues,mqttNetwork,mqttFilters,mqttProperties,MAX_MQTT_CONNECTIONS} from '../src/mqtt/model.js';
const module=id=>catalog.modules.find(module=>module.id===id);
function fixture(protocol='3.1.1'){
 let project=createProject('MQTT model','', 'waveshare-esp32-s3-eth',{camera:'disconnected'});
 project=addHardware(project,module('clex.hardware.ethernet'),catalog);
 project=addHardware(project,module(MQTT_MODULE),catalog);
 const component=project.components.at(-1);Object.assign(component.parameters,{host:'localhost',protocol});
 for(const id of MQTT_LOGIC_MODULES)project=withLogic(project,addNode(project.logic,module(id),project.components,project,catalog));
 const control=project.logic.nodes[0],send=project.logic.nodes[1],receive=project.logic.nodes[2];send.parameters.topic='clex/test';receive.parameters.filters=JSON.stringify([{topic:'clex/+',qos:1}]);
 return {project,component,control,send,receive};
}
test('MQTT catalog exposes one software component, exactly three nodes, and existing ESP32 network platforms',()=>{
 assert.deepEqual(catalog.modules.filter(module=>module.id.startsWith('clex.logic.mqtt-')).map(module=>module.id).sort(),[...MQTT_LOGIC_MODULES].sort());
 assert.equal(module(MQTT_MODULE).terminals.length,0);
 for(const board of catalog.boards.filter(board=>board.pins.length)){
  const expected=board.platform==='esp-idf';
  for(const id of [MQTT_MODULE,...MQTT_LOGIC_MODULES])assert.equal(moduleSupportsBoard(module(id),board),expected,board.id+' '+id);
 }
 const {project,control,send,receive}=fixture();
 for(const node of [control,send,receive]){assert.equal(hardwareBinding(node,project,catalog).error,null);assert.equal(logicAdditionProblem(module(node.moduleId),project,catalog),null);}
 assert.deepEqual(nodePorts(control,catalog,project).inputs.map(port=>port.id),['connect','disconnect']);
 assert.deepEqual(nodePorts(receive,catalog,project).inputs.map(port=>port.id),['subscribe','unsubscribe']);
 assert.ok(nodePorts(send,catalog,project).inputs.some(port=>port.id==='trigger'));
});
test('MQTT uses existing Ethernet or Wi-Fi and can autoconnect without a control node',()=>{
 const {project,component}=fixture();project.logic.nodes=[];
 assert.deepEqual(mqttIssues(component,project,catalog),[]);
 assert.equal(mqttNetwork(component,project,catalog).moduleId,'clex.hardware.ethernet');
 assert.equal(validateAssembly(project,catalog).some(issue=>issue.severity==='error'),false);
 assert.deepEqual(parseProject(serializeProject(project)),project);
 component.parameters.networkId='deleted';assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('Ethernet')));
 component.parameters.networkId='';project.components=project.components.filter(component=>component.moduleId!=='clex.hardware.ethernet');
 assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('Ethernet')));
});
test('MQTT validates host, stable session identity, CA, integers and unique Client IDs',()=>{
 const {project,component}=fixture('5.0');
 for(const host of ['localhost','broker.example.org','192.0.2.1','[::1]','::1']){component.parameters.host=host;assert.deepEqual(mqttIssues(component,project,catalog),[],host);}
 for(const host of ['mqtt://localhost','host/path','host:1883','user@host','host name']){component.parameters.host=host;assert.ok(mqttIssues(component,project,catalog).length,host);}
 Object.assign(component.parameters,{host:'localhost',cleanSession:false});assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('Client ID')));
 component.parameters.clientId='fixed';assert.deepEqual(mqttIssues(component,project,catalog),[]);
 component.parameters.keepAlive=1.5;assert.ok(mqttIssues(component,project,catalog).length);component.parameters.keepAlive=60;
 Object.assign(component.parameters,{tls:true,caMode:'pem',caPem:'not a certificate'});assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('PEM')));
 Object.assign(component.parameters,{caMode:'bundle',cleanSession:true});assert.deepEqual(mqttIssues(component,project,catalog),[]);
 const next=addHardware(project,module(MQTT_MODULE),catalog);Object.assign(next.components.at(-1).parameters,{host:'localhost',clientId:'fixed'});assert.ok(mqttIssues(component,next,catalog).some(message=>message.includes('разные Client ID')));
});
test('MQTT topics, filters and encoded payloads preserve protocol boundaries',()=>{
 for(const topic of ['a','/','a//b','тест/😀'])assert.equal(mqttTopicValid(topic),true,topic);
 for(const topic of ['','a/+','a/#','a\0b','\ud800'])assert.equal(mqttTopicValid(topic),false,topic);
 for(const filter of ['#','+','a/+/b/#','$share/team/a/+'])assert.equal(mqttTopicValid(filter,{filter:true}),true,filter);
 for(const filter of ['a#','a/+b','a/#/b','$share//a','$share/g+/a','$share/g/'])assert.equal(mqttTopicValid(filter,{filter:true}),false,filter);
 assert.equal(mqttTopicValid('я'.repeat(129)),false);
 assert.equal(mqttPayloadBytes('я'),2);assert.equal(mqttPayloadBytes('AP8=','base64'),2);assert.equal(mqttPayloadBytes('00ff','hex'),2);
 assert.equal(mqttPayloadBytes('0','hex'),null);assert.equal(mqttPayloadBytes('???','base64'),null);
});
test('MQTT logic validates multiple subscriptions, binary payload sizes and MQTT 5 properties',()=>{
 const {project,send,receive}=fixture('5.0');
 assert.deepEqual(mqttLogicIssues(send,project),[]);assert.deepEqual(mqttLogicIssues(receive,project),[]);
 send.parameters.payloadEncoding='hex';send.parameters.payload='ab'.repeat(4096);assert.deepEqual(mqttLogicIssues(send,project),[]);send.parameters.payload+='ff';assert.ok(mqttLogicIssues(send,project).some(message=>message.includes('4096')));
 Object.assign(send.parameters,{payload:'ff',contentType:'application/octet-stream',responseTopic:'reply/1',correlationData:'AQI=',userProperties:'[{"key":"source","value":"CLEX"}]',messageExpiry:30});assert.deepEqual(mqttLogicIssues(send,project),[]);
 project.components.at(-1).parameters.protocol='3.1.1';assert.ok(mqttLogicIssues(send,project).some(message=>message.includes('MQTT 5.0')));project.components.at(-1).parameters.protocol='5.0';
 receive.parameters.filters='[{"topic":"a/+","qos":1},{"topic":"b/#","qos":2}]';assert.deepEqual(mqttLogicIssues(receive,project),[]);
 receive.parameters.filters='[{"qos":1}]';receive.parameters.noLocal=true;assert.ok(mqttLogicIssues(receive,project).length);
 receive.parameters.filters='[{"topic":"$share/group/a","qos":1}]';assert.ok(mqttLogicIssues(receive,project).some(message=>message.includes('No Local')));
 receive.parameters.noLocal=false;receive.parameters.filters='[{"topic":"a","qos":1}]';
 const other=structuredClone(receive);other.id=crypto.randomUUID();other.parameters.retainHandling='2';project.logic.nodes.push(other);assert.ok(mqttLogicIssues(receive,project).some(message=>message.includes('одинаковые параметры')));
});

test('MQTT connection ownership survives project persistence and binds independently without pins',()=>{
 let {project,component,send}=fixture('5.0');
 project=addHardware(project,module('clex.hardware.router'),catalog);
 const router=project.components.at(-1),ethernet=project.components.find(component=>component.moduleId==='clex.hardware.ethernet');
 assert.equal(mqttNetwork(component,project,catalog).id,router.id);
 component.parameters.networkId=ethernet.id;assert.equal(mqttNetwork(component,project,catalog).id,ethernet.id);
 project=addHardware(project,module(MQTT_MODULE),catalog);
 const other=project.components.at(-1);Object.assign(other.parameters,{host:'second.example.org',protocol:'5.0',clientId:'second',username:'mqtt',password:'local-test-password',tls:true,networkId:router.id,cleanSession:false,sessionExpiry:3600,lwtEnabled:true,lwtTopic:'status/second',lwtPayload:'offline',lwtQos:'2',lwtRetain:true,lwtDelay:5});
 send=project.logic.nodes.find(node=>node.id===send.id);send.parameters.componentId=other.id;
 const restored=parseProject(serializeProject(project)),binding=hardwareBinding(restored.logic.nodes.find(node=>node.id===send.id),restored,catalog);
 assert.equal(binding.component.id,other.id);assert.equal(binding.gpio,null);assert.equal(binding.error,null);
 assert.deepEqual(mqttIssues(binding.component,restored,catalog),[]);
 assert.equal(restored.gpioAssignments.length,0);assert.equal(restored.assembly.connections.length,0);
 assert.equal(restored.components.find(component=>component.id===other.id).parameters.password,'local-test-password');
 restored.components=restored.components.filter(component=>component.id!==router.id);
 assert.ok(mqttIssues(binding.component,restored,catalog).some(message=>message.includes('Ethernet')));
});
test('MQTT enforces independent connection capacity and detects equivalent explicit client endpoints',()=>{
 let {project,component}=fixture();
 for(let n=1;n<MAX_MQTT_CONNECTIONS;n++)project=addHardware(project,module(MQTT_MODULE),catalog);
 assert.equal(project.components.filter(component=>component.moduleId===MQTT_MODULE).length,MAX_MQTT_CONNECTIONS);
 assert.throws(()=>addHardware(project,module(MQTT_MODULE),catalog),/MQTT/);
 const other=project.components.filter(component=>component.moduleId===MQTT_MODULE)[1];
 Object.assign(component.parameters,{host:'[0:0:0:0:0:0:0:1]',clientId:'same'});Object.assign(other.parameters,{host:'::1',clientId:'same'});
 assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('разные Client ID')));
 other.parameters.port=1884;assert.deepEqual(mqttIssues(component,project,catalog),[]);
 Object.assign(component.parameters,{host:'Broker.Example.Org.',clientId:'same'});Object.assign(other.parameters,{host:'broker.example.org',port:1883});
 assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('разные Client ID')));
});
test('MQTT rejects malformed hosts, overflow, invalid booleans and partially valid certificate text',()=>{
 const {project,component}=fixture('5.0');
 for(const host of ['[::1]/','[::1]:1883','[::1]?a','a%20b','a..b','-broker.local','broker-.local','192.0.2.999','брокер.рф','a'.repeat(64)+'.local']){
  component.parameters.host=host;assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('хоста')),host);
 }
 for(const host of ['broker.local.','mqtt_broker','xn--90ac9a9a.xn--p1ai','2001:db8::1']){component.parameters.host=host;assert.deepEqual(mqttIssues(component,project,catalog),[],host);}
 component.parameters.host='localhost';
 for(const [key,value]of[['port',65536],['keepAlive',-1],['sessionExpiry',4294967296],['reconnectMs',999],['timeoutMs',120001],['lwtDelay',0.5],['autoConnect','true'],['tls',1]]){
  const old=component.parameters[key];component.parameters[key]=value;assert.ok(mqttIssues(component,project,catalog).length,key);component.parameters[key]=old;
 }
 const pem='-----BEGIN CERTIFICATE-----\n'+Buffer.alloc(96).toString('base64')+'\n-----END CERTIFICATE-----';
 Object.assign(component.parameters,{tls:true,caMode:'pem',caPem:pem});assert.deepEqual(mqttIssues(component,project,catalog),[]);
 for(const caPem of [pem+'garbage',pem.replace('END CERTIFICATE','END PRIVATE KEY'),'-----BEGIN CERTIFICATE-----\n!!!\n-----END CERTIFICATE-----',pem.repeat(100)]){
  component.parameters.caPem=caPem;assert.ok(mqttIssues(component,project,catalog).some(message=>message.includes('PEM')));
 }
});
test('MQTT filters retain UTF-8 limits and JSON parsing stays bounded for imported projects',()=>{
 for(const topic of ['я'.repeat(128),'😀'.repeat(64),'$SYS/broker/clients'])assert.equal(mqttTopicValid(topic),true,topic);
 for(const topic of ['я'.repeat(128)+'a','😀'.repeat(64)+'a','a\udc00','a\ud800b'])assert.equal(mqttTopicValid(topic),false);
 for(const filter of ['$SYS/#','$share/team/$SYS/#','$share/team/$share/nested/a','$share/team/$share/topic/#','$share/team/a//+','/+/','#'])assert.equal(mqttTopicValid(filter,{filter:true}),true,filter);
 for(const filter of ['$share/team+/a','a/##','a/+/#/','a/+/#b'])assert.equal(mqttTopicValid(filter,{filter:true}),false,filter);
 for(const value of ['not JSON','null','{}','[null]','[[]]','[1]']){assert.equal(mqttFilters(value),null,value);assert.equal(mqttProperties(value),null,value);}
 assert.equal(mqttFilters(JSON.stringify(Array.from({length:17},()=>({topic:'a',qos:0})))),null);
 assert.equal(mqttProperties(JSON.stringify(Array.from({length:33},()=>({key:'a',value:'b'})))),null);
});
test('MQTT 5 payload format validates decoded bytes while binary and dynamic payloads remain available',()=>{
 const {project,send}=fixture('5.0');
 Object.assign(send.parameters,{payloadFormatIndicator:'1',payloadEncoding:'base64',payload:Buffer.from('Привет 😀').toString('base64')});
 assert.deepEqual(mqttLogicIssues(send,project),[]);
 for(const payload of ['AP8=','wIA=','7aCA']){send.parameters.payload=payload;assert.ok(mqttLogicIssues(send,project).some(message=>message.includes('Format Indicator')),payload);}
 send.parameters.payload='AA==';assert.deepEqual(mqttLogicIssues(send,project),[]);
 Object.assign(send.parameters,{payloadFormatIndicator:'0',payload:'AP8=',messageExpiry:0});assert.deepEqual(mqttLogicIssues(send,project),[]);
 Object.assign(send.parameters,{payloadEncoding:'hex',payload:'f09f9880',payloadFormatIndicator:'1'});assert.deepEqual(mqttLogicIssues(send,project),[]);
 send.parameters.payload='ff';assert.ok(mqttLogicIssues(send,project).length);
 project.logic.edges.push({id:'dynamic-data',source:'some-text-node',sourceHandle:'text',target:send.id,targetHandle:'payload'});
 assert.deepEqual(mqttLogicIssues(send,project),[]);
});
test('MQTT multiple subscription owners support different QoS and isolate options by connection',()=>{
 let {project,component,receive}=fixture('5.0');
 receive.parameters.filters=JSON.stringify([{topic:'clex/+',qos:0}]);
 const other=structuredClone(receive);other.id=crypto.randomUUID();other.parameters.filters=JSON.stringify([{topic:'clex/+',qos:2}]);project.logic.nodes.push(other);
 assert.deepEqual(mqttLogicIssues(receive,project),[]);assert.deepEqual(mqttLogicIssues(other,project),[]);
 other.parameters.retainHandling='1';assert.ok(mqttLogicIssues(receive,project).some(message=>message.includes('одинаковые параметры')));
 project=addHardware(project,module(MQTT_MODULE),catalog);other.parameters.componentId=project.components.at(-1).id;
 assert.deepEqual(mqttLogicIssues(receive,project),[]);
 receive.parameters.filters=JSON.stringify([{topic:'same',qos:0},{topic:'same',qos:1}]);assert.ok(mqttLogicIssues(receive,project).some(message=>message.includes('уникальные')));
 component.parameters.protocol='3.1.1';Object.assign(receive.parameters,{filters:'[{"topic":"clex/#","qos":0}]',noLocal:true});assert.ok(mqttLogicIssues(receive,project).some(message=>message.includes('MQTT 5.0')));
});
test('MQTT 5 user properties are UTF-8 bounded and metadata changes can drive display refresh',()=>{
 const {project,send,control}=fixture('5.0');
 send.parameters.userProperties=JSON.stringify([{key:'я'.repeat(64),value:'😀'.repeat(128)}]);assert.deepEqual(mqttLogicIssues(send,project),[]);
 for(const row of [{key:'я'.repeat(65),value:''},{key:'',value:'😀'.repeat(129)},{key:'a\0',value:'b'},{key:'a',value:'\ud800'},{key:1,value:'b'}]){
  send.parameters.userProperties=JSON.stringify([row]);assert.ok(mqttLogicIssues(send,project).some(message=>message.includes('User Properties')));
 }
 for(const id of ['state','isConnected'])assert.equal(nodePorts(control,catalog,project).outputs.find(port=>port.id===id).readyOn,'changed');
});

test('shared MQTT filters can target literal topics beginning with $share',()=>{
 const {project,send,receive}=fixture('5.0');
 receive.parameters.filters=JSON.stringify([{topic:'$share/team/$share/topic/#',qos:1}]);
 send.parameters.topic='$share/topic/value';
 assert.deepEqual(mqttLogicIssues(receive,project),[]);assert.deepEqual(mqttLogicIssues(send,project),[]);
});
