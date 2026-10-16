import {ESPNOW_MODULE,readPeers} from '../../espnow/model.js';
import {ESPNOW_RUNTIME} from './esp-idf/espnow-runtime.js';
const bytes=value=>'{'+(value.match(/../g)||[]).map(part=>'0x'+part).join(',')+'}';
export function espNowFirmware(project,nodes,index,cString,netifReady){
 const components=project.components.filter(c=>c.moduleId===ESPNOW_MODULE),blocks=nodes.filter(n=>n.moduleId.startsWith('clex.logic.espnow-'));
 const empty={enabled:false,headers:'',source:'',notify:'',initialize:'',poll:'',features:[],expressions:new Map(),textSizes:new Map(),operations:new Map(),extraFunctions:new Map(),eventModules:new Set()};
 if(!components.length&&!blocks.length)return empty;
 if(components.length!==1)throw new Error('Добавьте один ESP-NOW-интерфейс в монтаж.');
 const component=components[0],p=component.parameters,peers=readPeers(component),expressions=new Map(),textSizes=new Map(),operations=new Map(),extraFunctions=new Map();
 let declarations='',notify='static void clex_en_notify(unsigned kind,unsigned node){\n (void)node;\n switch(kind){\n';
 const sourceFor={status:'clex_en_status',received:'clex_en_message','command-received':'clex_en_command'};
 for(const node of blocks){
  const i=index.get(node.id),kind=node.moduleId.slice('clex.logic.espnow-'.length),value='espnow_value_'+i;
  if(sourceFor[kind]){
   const status=kind==='status';declarations+=`static ${status?'clex_en_status_t':'clex_en_received_t'} ${value};\n`;
   const fields=status?['ready','mode','mac','sent','received','lost','error']:['sender','text','command','rssi'];expressions.set(node.id,Object.fromEntries(fields.map(key=>[key,value+'.'+key])));textSizes.set(node.id,status?{mac:18,error:128}:{sender:18,text:161,command:33});
   if(status)operations.set(node.id,`  ${value}=clex_en_status; node_${i}_emit_changed();`);
  }else{
   declarations+=`static char espnow_error_${i}[128];\n`;expressions.set(node.id,{error:'espnow_error_'+i});textSizes.set(node.id,{error:128});
   const finish=condition=>`  bool ok=(${condition});\n  snprintf(espnow_error_${i},sizeof(espnow_error_${i}),"%s",ok?"":clex_en_status.error);\n  if(ok) node_${i}_emit_done(); else node_${i}_emit_failed();`;
   if(kind==='mode')operations.set(node.id,finish('clex_en_set_mode('+(node.parameters.mode==='lr'?1:0)+')'));
   if(kind==='ack'){operations.set(node.id,finish('clex_en_respond(true)'));extraFunctions.set(node.id,`static void node_${i}_reject(void){\n${finish('clex_en_respond(false)')}\n}`);}
   if(['send','command-send'].includes(kind))operations.set(node.id,({inputEdge,dataExpression})=>{
    const input=inputEdge(node,'text'),text=input?dataExpression(input):cString(node.parameters.message),peer=peers.findIndex(peer=>peer.id===node.parameters.peerId);
    return `  if(!clex_en_send(${peer},${i},${kind==='command-send'},${cString(node.parameters.command||'')},${text})){snprintf(espnow_error_${i},sizeof(espnow_error_${i}),"%s",clex_en_status.error);node_${i}_emit_failed();}`;
   });
  }
 }
 for(const[kind,code]of [['status','EN_STATUS'],['received','EN_RECEIVED'],['command-received','EN_COMMAND_RECEIVED']]){
  notify+=` case ${code}: {\n`+(kind==='command-received'?' bool handled=false;\n':'');
  for(const node of blocks.filter(n=>n.moduleId==='clex.logic.espnow-'+kind)){const i=index.get(node.id),statement=`espnow_value_${i}=${sourceFor[kind]};node_${i}_emit_${kind==='status'?'changed':'received'}();`;notify+=kind==='command-received'?` if(!strcmp(clex_en_command.command,${cString(node.parameters.command)})){handled=true;${statement}}\n`:` ${statement}\n`;}
  if(kind==='command-received')notify+=' if(!handled)clex_en_respond(false);\n';notify+=' break; }\n';
 }
 for(const[kind,code,port]of [['confirmed','EN_CONFIRMED','confirmed'],['failed','EN_FAILED','failed']]){notify+=` case ${code}: switch(node){\n`;for(const node of blocks.filter(n=>['clex.logic.espnow-send','clex.logic.espnow-command-send'].includes(n.moduleId))){const i=index.get(node.id);notify+=` case ${i}: snprintf(espnow_error_${i},sizeof(espnow_error_${i}),"%s",${kind==='confirmed'?'""':'clex_en_status.error'});node_${i}_emit_${port}();break;\n`;}notify+=' default:break;}break;\n';}notify+=' default:break;}\n}\n';
 const config=`static const clex_en_config_t clex_en_config[${peers.length||1}]={\n${peers.length?peers.map(peer=>` { .mac=${bytes(peer.mac.replaceAll(':',''))},.lmk=${bytes(p.encryption&&peer.encrypted?peer.lmk:'00'.repeat(16))},.encrypted=${Boolean(p.encryption&&peer.encrypted)} },`).join('\n'):' { .mac={0},.lmk={0},.encrypted=false }'}\n};`;
 const replacements={CONFIG:config,COUNT:peers.length,TIMEOUT:p.timeoutMs,RETRIES:p.retries,ALLOW_MODE:p.allowModeChange?'1':'0',COMPONENT:cString(component.id),NETIF:netifReady?'':'err=esp_netif_init();if(err!=ESP_OK){en_error("Не удалось подготовить Wi-Fi netif");goto finish;}',PMK:p.encryption?`{const uint8_t pmk[16]=${bytes(p.pmk)};EN_INIT(esp_now_set_pmk(pmk));}`:'',MODE:p.mode==='lr'?1:0,CHANNEL:p.channel};
 const runtime=ESPNOW_RUNTIME.replace(/@([A-Z_]+)@/g,(_,name)=>String(replacements[name]));
 return {...empty,enabled:true,features:['espnow-s3'],headers:'#include "esp_wifi.h"\n#include "esp_now.h"\n#include "esp_random.h"\n#include "esp_mac.h"\n#include "esp_event.h"\n#include "esp_netif.h"\n#include "nvs_flash.h"\n#include "mbedtls/md.h"',source:runtime+'\n'+declarations,notify,initialize:'  clex_en_initialize();',poll:'    clex_en_poll();',expressions,textSizes,operations,extraFunctions,eventModules:new Set(blocks.map(n=>n.moduleId))};
}
