import {ESPNOW_MODULE,readPeers} from '../../espnow/model.js';
import {ESPNOW_RUNTIME} from './esp-idf/espnow-runtime.js';
import {ESPNOW_HEALTH} from './esp-idf/espnow-health.js';
import {espNowPersistence} from './esp-idf/espnow-persistence.js';
const bytes=value=>'{'+(value.match(/../g)||[]).map(part=>'0x'+part).join(',')+'}';
export function espNowFirmware(project,nodes,index,cString,netifReady,target='esp32s3'){
 const components=project.components.filter(c=>c.moduleId===ESPNOW_MODULE),blocks=nodes.filter(n=>n.moduleId.startsWith('clex.logic.espnow-'));
 const empty={enabled:false,headers:'',source:'',notify:'',initialize:'',poll:'',features:[],expressions:new Map(),textSizes:new Map(),textGlyphs:new Map(),operations:new Map(),extraFunctions:new Map(),eventModules:new Set()};
 if(!components.length&&!blocks.length)return empty;
 const profile={esp32:'espnow-esp32',esp32s3:'espnow-s3'}[target];
 if(!profile)throw new Error('Для платы нет реализованного ESP-NOW-драйвера.');
 if(components.length!==1)throw new Error('Добавьте один ESP-NOW-интерфейс в монтаж.');
 const component=components[0],p=component.parameters,peers=readPeers(component),expressions=new Map(),textSizes=new Map(),textGlyphs=new Map(),operations=new Map(),extraFunctions=new Map();
 const status=node=>node.moduleId==='clex.logic.espnow-control'&&node.parameters.action==='status';
 const monitor=node=>node.moduleId==='clex.logic.espnow-control'&&node.parameters.action==='peer';
 const receive=node=>node.moduleId==='clex.logic.espnow-receive';
 const command=node=>node.parameters.transferType==='command';
 let declarations='',notify='static void clex_en_notify(unsigned kind,unsigned node){\n (void)node;\n switch(kind){\n';
 for(const node of blocks){
  const i=index.get(node.id),value='espnow_value_'+i;
  if(status(node)||receive(node)||monitor(node)){
   declarations+=`static ${status(node)?'clex_en_status_t':monitor(node)?'clex_en_peer_snapshot_t':'clex_en_received_t'} ${value};\n`;
   if(monitor(node))declarations+=`static bool espnow_view_ready_${i};\n`;
   const fields=status(node)?['ready','mode','mac','sent','received','lost']:monitor(node)?['peerState','online','rssi','rssiValid','rssiText','lastSeenSeconds']:['sender','text','command','rssi'];
   expressions.set(node.id,{...Object.fromEntries(fields.map(key=>[key,value+'.'+key])),...(status(node)?{statusError:value+'.error'}:{})});
   if(monitor(node)){
    Object.assign(expressions.get(node.id),Object.fromEntries(Object.entries({testSent:'sent',testReceived:'received',testLost:'lost',lossPercent:'lossPercent',statisticsValid:'valid',statisticsText:'text',pendingPackets:'pending',testSendErrors:'sendErrors'}).map(([key,field])=>[key,value+'.stats.'+field])));
    const peer=peers.findIndex(peer=>peer.id===node.parameters.peerId);
    extraFunctions.set(node.id,`static void node_${i}_resetStatistics(void){clex_en_reset_statistics(${peer});}\n`);
    textGlyphs.set(node.id,'Получено из Потери Нет свежего отчета (),%');
   }
   textSizes.set(node.id,status(node)?{mac:18,statusError:128}:monitor(node)?{rssiText:16,statisticsText:160}:{sender:18,text:161,command:33});
   if(status(node))operations.set(node.id,`  ${value}=clex_en_status; node_${i}_emit_changed();`);
  }else{
   declarations+=`static char espnow_error_${i}[128];\n`;expressions.set(node.id,{error:'espnow_error_'+i});textSizes.set(node.id,{error:128});
   const finish=condition=>`  bool ok=(${condition});\n  snprintf(espnow_error_${i},sizeof(espnow_error_${i}),"%s",ok?"":clex_en_status.error);\n  if(ok) node_${i}_emit_done(); else node_${i}_emit_failed();`;
   if(node.moduleId==='clex.logic.espnow-control')operations.set(node.id,finish('clex_en_set_mode('+(node.parameters.mode==='lr'?1:0)+')'));
   if(node.moduleId==='clex.logic.espnow-ack'){operations.set(node.id,finish('clex_en_respond(true)'));extraFunctions.set(node.id,`static void node_${i}_reject(void){\n${finish('clex_en_respond(false)')}\n}`);}
   if(node.moduleId==='clex.logic.espnow-send')operations.set(node.id,({inputEdge,dataExpression})=>{
    const input=inputEdge(node,'text'),text=input?dataExpression(input):cString(node.parameters.message),peer=peers.findIndex(peer=>peer.id===node.parameters.peerId);
    return `  if(!clex_en_send(${peer},${i},${command(node)},${cString(command(node)?node.parameters.command:'')},${text})){snprintf(espnow_error_${i},sizeof(espnow_error_${i}),"%s",clex_en_status.error);node_${i}_emit_failed();}`;
   });
  }
 }
 notify+=' case EN_PEER: {\n';
 for(const node of blocks.filter(monitor)){
  const i=index.get(node.id),peer=peers.findIndex(peer=>peer.id===node.parameters.peerId),value='espnow_value_'+i;
  const same=['peerState','online','rssi','rssiValid','lastSeenSeconds','stats.sent','stats.received','stats.pending','stats.sendErrors','stats.valid'].map(field=>`next.${field}==${value}.${field}`).join('&&');
  notify+=` if(node==${peer}){clex_en_peer_snapshot_t next=clex_en_peer_read(${peer},${node.parameters.offlineTimeoutMs});\n  if(!espnow_view_ready_${i}||!(${same})) {bool appeared=next.online&&!${value}.online;bool disappeared=espnow_view_ready_${i}&&((!next.online&&${value}.online)||(next.peerState==2&&${value}.peerState!=2));${value}=next;espnow_view_ready_${i}=true;node_${i}_emit_peerChanged();if(appeared){node_${i}_emit_connected();}if(disappeared){node_${i}_emit_disconnected();}}\n }\n`;
 }
 notify+=' break; }\n';
 for(const kind of ['status','message','command']){
  notify+=` case ${kind==='status'?'EN_STATUS':kind==='message'?'EN_RECEIVED':'EN_COMMAND_RECEIVED'}: {\n`+(kind==='command'?' bool handled=false;\n':'');
  for(const node of blocks.filter(node=>kind==='status'?status(node):receive(node)&&command(node)===(kind==='command'))){
   const i=index.get(node.id),source=kind==='status'?'clex_en_status':kind==='message'?'clex_en_message':'clex_en_command',port=kind==='status'?'changed':kind==='message'?'messageReceived':'commandReceived';
   const statement=`espnow_value_${i}=${source};node_${i}_emit_${port}();`;
   notify+=kind==='command'?` if(!strcmp(clex_en_command.command,${cString(node.parameters.command)})){handled=true;${statement}}\n`:` ${statement}\n`;
  }
  if(kind==='command')notify+=' if(!handled)clex_en_respond(false);\n';notify+=' break; }\n';
 }
 for(const[kind,code]of [['confirmed','EN_CONFIRMED'],['failed','EN_FAILED']]){
  notify+=` case ${code}: switch(node){\n`;
  for(const node of blocks.filter(node=>node.moduleId==='clex.logic.espnow-send')){
   const i=index.get(node.id),port=kind==='failed'?'failed':command(node)?'completed':'accepted';
   notify+=` case ${i}: snprintf(espnow_error_${i},sizeof(espnow_error_${i}),"%s",${kind==='confirmed'?'""':'clex_en_status.error'});node_${i}_emit_${port}();break;\n`;
  }
  notify+=' default:break;}break;\n';
 }
 notify+=' default:break;}\n}\n';
 const config=`static const clex_en_config_t clex_en_config[${peers.length||1}]={\n${peers.length?peers.map(peer=>` { .mac=${bytes(peer.mac.replaceAll(':',''))},.lmk=${bytes(p.encryption&&peer.encrypted?peer.lmk:'00'.repeat(16))},.encrypted=${Boolean(p.encryption&&peer.encrypted)} },`).join('\n'):' { .mac={0},.lmk={0},.encrypted=false }'}\n};`;
 const replacements={CONFIG:config,COUNT:peers.length,TIMEOUT:p.timeoutMs,RETRIES:p.retries,ALLOW_MODE:p.allowModeChange?'1':'0',COMPONENT:cString(component.id),NETIF:netifReady?'':'err=esp_netif_init();if(err!=ESP_OK){en_error("Не удалось подготовить Wi-Fi netif");goto finish;}',PMK:p.encryption?`{const uint8_t pmk[16]=${bytes(p.pmk)};EN_INIT(esp_now_set_pmk(pmk));}`:'',MODE:p.mode==='lr'?1:0,CHANNEL:p.channel};
 replacements.MODE_STORAGE=espNowPersistence(project.id,component.id,cString,p.rememberMode===true);
 const intervals=peers.map(peer=>{const values=blocks.filter(node=>monitor(node)&&node.parameters.peerId===peer.id).map(node=>node.parameters.probeIntervalMs);return values.length?Math.min(...values)*1000:0;});
 replacements.PEER_HEALTH=ESPNOW_HEALTH.replace('@HEALTH_INTERVALS@','{'+(intervals.join(',')||'0')+'}');
 const runtime=ESPNOW_RUNTIME.replace(/@([A-Z_]+)@/g,(_,name)=>String(replacements[name]));
 return {...empty,enabled:true,features:[profile],headers:'#include "esp_wifi.h"\n#include "esp_now.h"\n#include "esp_random.h"\n#include "esp_mac.h"\n#include "esp_event.h"\n#include "esp_netif.h"\n#include "nvs_flash.h"\n#include "mbedtls/md.h"'+(p.rememberMode===true?'\n#include "nvs.h"':''),source:runtime+'\n'+declarations,notify,initialize:'  clex_en_initialize();',poll:'    clex_en_poll();',expressions,textSizes,textGlyphs,operations,extraFunctions,eventModules:new Set(blocks.map(node=>node.moduleId))};
}
