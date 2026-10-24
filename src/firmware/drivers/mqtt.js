import {mqttIssues,mqttLogicIssues,mqttNetwork} from '../../mqtt/model.js';
import {MQTT_RUNTIME} from './esp-idf/mqtt-runtime.js';

const MODULE='clex.hardware.mqtt';
const LOGIC=new Set(['clex.logic.mqtt-control','clex.logic.mqtt-send','clex.logic.mqtt-receive']);
const list=value=>{if(Array.isArray(value))return value;try{return JSON.parse(value||'[]');}catch{return [];}};
const idSuffix=value=>{let hash=2166136261;for(const byte of new TextEncoder().encode(value)){hash=Math.imul(hash^byte,16777619)>>>0;}return hash.toString(16).padStart(8,'0');};
const encoding=value=>({utf8:0,base64:1,hex:2}[value]??0);

export function mqttFirmware(project,catalog,nodes,index,cString){
 const empty={enabled:false,headers:'',source:'',notify:'',initialize:'',poll:'',features:[],expressions:new Map(),textSizes:new Map(),textGlyphs:new Map(),operations:new Map(),extraFunctions:new Map(),eventModules:new Set()};
 const components=[...project.components].filter(c=>c.moduleId===MODULE).sort((a,b)=>a.id.localeCompare(b.id));
 const blocks=nodes.filter(n=>LOGIC.has(n.moduleId));
 if(!components.length&&!blocks.length)return empty;
 const board=catalog.boards.find(b=>b.id===project.boardId);
 if(board?.platform!=='esp-idf')throw new Error('MQTT требует плату с ESP-IDF и настроенным Wi-Fi или Ethernet.');
 for(const component of components){const issues=mqttIssues(component,project,catalog);if(issues.length)throw new Error(issues.join(' '));}
 for(const node of blocks){const issues=mqttLogicIssues(node,project);if(issues.length)throw new Error(issues.join(' '));}
 const clientIndex=new Map(components.map((c,i)=>[c.id,i]));
 const expressions=new Map(),textSizes=new Map(),textGlyphs=new Map(),operations=new Map(),extraFunctions=new Map();
 const receive=blocks.filter(n=>n.moduleId==='clex.logic.mqtt-receive'),send=blocks.filter(n=>n.moduleId==='clex.logic.mqtt-send');
 const filters=[],owners=[];
 for(const node of receive){
  const client=clientIndex.get(node.parameters.componentId);if(client===undefined)throw new Error('Выберите MQTT-подключение для блока.');
  const p=node.parameters,ids=[];
  for(const item of list(p.filters)){
   let id=filters.findIndex(f=>f.client===client&&f.topic===item.topic);
   if(id<0){id=filters.length;filters.push({client,topic:item.topic,noLocal:Boolean(p.noLocal),retainAsPublished:Boolean(p.retainAsPublished),retainHandling:Number(p.retainHandling||0)});}
   const existing=filters[id];
   if(existing.noLocal!==Boolean(p.noLocal)||existing.retainAsPublished!==Boolean(p.retainAsPublished)||existing.retainHandling!==Number(p.retainHandling||0))throw new Error('Одинаковые MQTT-фильтры одного подключения должны иметь одинаковые параметры MQTT 5.0.');
   ids.push({id,qos:Number(item.qos)});
  }
  owners.push({client,node:index.get(node.id),enabled:p.autoSubscribe!==false,encoding:encoding(p.payloadEncoding),ids});
 }
 const automaticIds=new Set();
 const configs=components.map(component=>{
  const p=component.parameters,network=mqttNetwork(component,project,catalog);
  const id=p.clientId||'',suffix=idSuffix(component.id);
  if(!id){if(automaticIds.has(suffix))throw new Error('Совпали автоматические MQTT Client ID. Задайте постоянный Client ID.');automaticIds.add(suffix);}
  return `{.component=${cString(component.id)},.host=${cString(p.host.replace(/^\[|\]$/g,''))},.port=${Number(p.port)},.v5=${p.protocol==='5.0'},.client_id=${cString(id)},.auto_suffix=${cString(suffix)},.username=${cString(p.username||'')},.password=${cString(p.password||'')},.tls=${Boolean(p.tls)},.router=${network?.moduleId==='clex.hardware.router'},.ca=${cString(p.caMode==='pem'?p.caPem||'':'')},.if_key=${cString(network?.moduleId==='clex.hardware.ethernet'?network.id:network?.moduleId==='clex.hardware.wifi'?'WIFI_STA_DEF':'')},.keepalive=${Number(p.keepAlive)},.clean=${p.cleanSession!==false},.expiry=${Number(p.sessionExpiry||0)}u,.autoconnect=${p.autoConnect!==false},.reconnect=${p.autoReconnect!==false},.reconnect_ms=${Number(p.reconnectMs)},.timeout_ms=${Number(p.timeoutMs)},.will_topic=${cString(p.lwtEnabled?p.lwtTopic:'')},.will_payload=${cString(p.lwtEnabled?p.lwtPayload||'':'')},.will_qos=${Number(p.lwtQos||0)},.will_retain=${Boolean(p.lwtRetain)},.will_delay=${Number(p.lwtDelay||0)}u}`;
 });
 const sendConfigs=send.map(node=>{
  const p=node.parameters,client=clientIndex.get(p.componentId);if(client===undefined)throw new Error('Выберите MQTT-подключение для блока.');
  const properties=list(p.userProperties);
  return `{.client=${client},.node=${index.get(node.id)},.qos=${Number(p.qos||0)},.retain=${Boolean(p.retain)},.encoding=${encoding(p.payloadEncoding)},.expiry=${Number(p.messageExpiry??-1)}LL,.format=${p.payloadFormatIndicator==='unspecified'?-1:p.payloadFormatIndicator==='1'?1:0},.content_type=${cString(p.contentType||'')},.response_topic=${cString(p.responseTopic||'')},.correlation=${cString(p.correlationData||'')},.user_properties=${cString(JSON.stringify(properties))}}`;
 });
 const replacements={ROUTER_NETWORK:components.some(component=>mqttNetwork(component,project,catalog)?.moduleId==='clex.hardware.router')?'return atomic_load(&clex_rt_dns_wan);':'return NULL;',CLIENT_COUNT:components.length,OWNER_COUNT:owners.length,FILTER_COUNT:filters.length,SEND_COUNT:send.length,
  CONFIG:configs.join(',\n'),OWNERS:owners.map(owner=>`{.client=${owner.client},.node=${owner.node},.enabled=${owner.enabled},.encoding=${owner.encoding},.count=${owner.ids.length},.filters={${owner.ids.map(f=>`{${f.id},${f.qos}}`).join(',')}}}`).join(',\n')||'{0}',
  FILTERS:filters.map(f=>`{.client=${f.client},.topic=${cString(f.topic)},.no_local=${f.noLocal},.retain_published=${f.retainAsPublished},.retain_handling=${f.retainHandling},.applied=-2}`).join(',\n')||'{0}',SENDERS:sendConfigs.join(',\n')||'{0}'};
 const source=MQTT_RUNTIME.replace(/@([A-Z_]+)@/g,(_,key)=>String(replacements[key]));
 let notify='static void clex_mq_notify(unsigned kind,unsigned slot,unsigned node){(void)slot;(void)node;switch(kind){\n';
 for(const [kind,port]of [['MQ_STATE','changed'],['MQ_CONNECTED','connected'],['MQ_DISCONNECTED','disconnected'],['MQ_CLIENT_FAILED','failed']]){
  notify+=`case ${kind}:\n`;
  for(const n of blocks.filter(n=>n.moduleId==='clex.logic.mqtt-control'))notify+=`if(slot==${clientIndex.get(n.parameters.componentId)})node_${index.get(n.id)}_emit_${port}();\n`;
  notify+='break;\n';
 }
 for(const[kind,port]of [['MQ_SENT','sent'],['MQ_SEND_FAILED','failed'],['MQ_RECEIVED','received'],['MQ_SUBSCRIBED','subscribed'],['MQ_UNSUBSCRIBED','unsubscribed'],['MQ_RECEIVE_FAILED','failed']]){
  notify+=`case ${kind}:switch(node){\n`;
  for(const n of(kind==='MQ_SENT'||kind==='MQ_SEND_FAILED'?send:receive))notify+=`case ${index.get(n.id)}:node_${index.get(n.id)}_emit_${port}();break;\n`;
  notify+='default:break;}break;\n';
 }
 notify+='default:break;}}\n';
 for(const node of blocks){
  const client=clientIndex.get(node.parameters.componentId),i=index.get(node.id);if(client===undefined)throw new Error('Выберите MQTT-подключение для блока.');
  if(node.moduleId==='clex.logic.mqtt-control'){
   expressions.set(node.id,{state:`mq_clients[${client}].state`,isConnected:`mq_clients[${client}].connected`,error:`mq_clients[${client}].error`,reasonCode:`mq_clients[${client}].reason`});textSizes.set(node.id,{error:160});
   operations.set(node.id,`  clex_mq_connect(${client});`);extraFunctions.set(node.id,`static void node_${i}_disconnect(void){clex_mq_disconnect(${client});}\n`);
  }else if(node.moduleId==='clex.logic.mqtt-send'){
   const slot=send.indexOf(node),name=`mq_senders[${slot}]`;
   expressions.set(node.id,{messageId:name+'.message_id',reasonCode:name+'.reason',error:name+'.error'});textSizes.set(node.id,{error:160});
   operations.set(node.id,({inputEdge,dataExpression})=>{const topic=inputEdge(node,'topic'),payload=inputEdge(node,'payload');return `  clex_mq_send(${slot},${topic?dataExpression(topic):cString(node.parameters.topic)},${payload?dataExpression(payload):cString(node.parameters.payload)});`;});
  }else{
   const slot=receive.indexOf(node),name=`mq_owners[${slot}].value`;
   expressions.set(node.id,Object.fromEntries(['topic','payload','qos','retain','messageId','error','reasonCode','properties'].map(key=>[key,name+'.'+({messageId:'message_id',reasonCode:'reason'}[key]||key)])));
   textSizes.set(node.id,{topic:257,payload:8193,properties:16385,error:160});
   operations.set(node.id,`  clex_mq_subscribe(${slot},true);`);extraFunctions.set(node.id,`static void node_${i}_unsubscribe(void){clex_mq_subscribe(${slot},false);}\n`);
  }
 }
 return {...empty,enabled:true,headers:'#include "mqtt_client.h"\n#include "mqtt5_client.h"\n#include "esp_netif.h"\n#include "esp_crt_bundle.h"\n#include "esp_sntp.h"\n#include "mbedtls/base64.h"\n#include "cJSON.h"\n#include "lwip/sockets.h"\n#include <time.h>\n#include <errno.h>\n#include <stddef.h>\n#include <stdatomic.h>\n#include "esp_mac.h"',source,notify,initialize:'  clex_mq_initialize();',poll:'    clex_mq_poll();',features:['mqtt-'+board.target],expressions,textSizes,textGlyphs,operations,extraFunctions,eventModules:LOGIC};
}
