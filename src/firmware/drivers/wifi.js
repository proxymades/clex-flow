import {wifiComponent} from '../../wifi/model.js';
import {WIFI_RUNTIME} from './esp-idf/wifi-runtime.js';

export const WIFI_PARTITIONS='nvs,data,nvs,0x9000,0x6000\nphy_init,data,phy,0xf000,0x1000\nfactory,app,factory,0x10000,0x300000\n';
export function wifiFirmware(project,catalog,nodes,index,cString){
 const empty={enabled:false,headers:'',source:'',notify:'',poll:'',initialize:'',boardConfig:'',features:[],expressions:new Map(),textSizes:new Map(),operations:new Map(),extraFunctions:new Map()};
 const component=wifiComponent(project);if(!component)return empty;
 const p=component.parameters,board=catalog.boards.find(board=>board.id===project.boardId);
 const hasNetwork=project.components.some(c=>c.moduleId==='clex.hardware.ethernet')||nodes.some(n=>n.moduleId==='clex.logic.internet-check');
 const staticIp=p.addressMode==='static'?`
 error=esp_netif_dhcpc_stop(clex_wifi_netif);if(error!=ESP_OK&&error!=ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED)goto failure;
 esp_netif_ip_info_t ip={0};esp_netif_str_to_ip4(${cString(p.staticIp)},&ip.ip);esp_netif_str_to_ip4(${cString(p.netmask)},&ip.netmask);esp_netif_str_to_ip4(${cString(p.gateway)},&ip.gw);
 error=esp_netif_set_ip_info(clex_wifi_netif,&ip);if(error!=ESP_OK)goto failure;
 esp_netif_dns_info_t dns={.ip.type=ESP_IPADDR_TYPE_V4};esp_netif_str_to_ip4(${cString(p.dns||p.gateway)},&dns.ip.u_addr.ip4);
 error=esp_netif_set_dns_info(clex_wifi_netif,ESP_NETIF_DNS_MAIN,&dns);if(error!=ESP_OK)goto failure;`:'';
 const values={AUTO_CONNECT:String(p.autoConnect),AUTO_RECONNECT:String(p.autoReconnect),RETRY_US:String(p.reconnectMs*1000),TIMEOUT_US:String(p.connectTimeoutMs*1000),SSID:cString(p.ssid),PASSWORD:cString(p.password),SSID_BYTES:new TextEncoder().encode(p.ssid).length,PASSWORD_BYTES:new TextEncoder().encode(p.password).length,AUTH_MODE:p.password?'WIFI_AUTH_WPA2_PSK':'WIFI_AUTH_OPEN',STATIC_IP:staticIp,NETWORK_CHANGED:hasNetwork?'clex_network_changed();':''};
 const source=WIFI_RUNTIME.replace(/@([A-Z_]+)@/g,(_,key)=>String(values[key]));
 const expressions=new Map(),textSizes=new Map(),operations=new Map(),extraFunctions=new Map();
 let notify='static void clex_wifi_notify(unsigned flags,clex_wifi_snapshot_t value){(void)flags;(void)value;\n';
 let declarations='';
 for(const node of nodes.filter(n=>n.moduleId==='clex.logic.wifi')){
  const i=index.get(node.id),name='wifi_value_'+i;
  declarations+='\nstatic clex_wifi_snapshot_t '+name+';\n';
  expressions.set(node.id,{isConnected:name+'.connected',state:name+'.state',ip:name+'.ip',netmask:name+'.netmask',gateway:name+'.gateway',dns:name+'.dns',reasonCode:name+'.reason',error:name+'.error'});
  textSizes.set(node.id,{ip:16,netmask:16,gateway:16,dns:48,error:128});
  operations.set(node.id,'  clex_wifi_request(WF_STATUS);');
  extraFunctions.set(node.id,Object.entries({connect:'WF_CONNECT',disconnect:'WF_DISCONNECT',reconnect:'WF_RECONNECT'}).map(([action,command])=>'static void node_'+i+'_'+action+'(void){clex_wifi_request('+command+');}').join('\n'));
  notify+=name+'=value;node_'+i+'_emit_changed();'+Object.entries({connected:'WF_CONNECTED',disconnected:'WF_DISCONNECTED',ipChanged:'WF_IP_CHANGED',failed:'WF_FAILED'}).map(([port,flag])=>'if(flags&'+flag+')node_'+i+'_emit_'+port+'();').join('')+'\n';
 }
 notify+='}\n';
 return {...empty,enabled:true,headers:['esp_wifi.h','esp_wifi_default.h','esp_netif.h','esp_event.h','esp_sntp.h','nvs_flash.h','freertos/semphr.h'].map(header=>'#include "'+header+'"').join('\n'),source:source+declarations,notify,poll:'    clex_wifi_poll();',initialize:'  clex_wifi_initialize();',boardConfig:board.wifi.config||'',features:['wifi-sta-'+board.target,...(board.wifi.driverKey==='hosted'?[board.wifi.profileKey]:[])],expressions,textSizes,operations,extraFunctions};
}
