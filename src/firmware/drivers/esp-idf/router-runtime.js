// One routing controller. Physical Ethernet creation stays in ethernet-interface.js.
export const ROUTER_RUNTIME=String.raw`
enum { RT_CHANGED=1,RT_STARTED=2,RT_WAN_UP=4,RT_WAN_DOWN=8,RT_IP=16,RT_INTERNET_UP=32,RT_INTERNET_DOWN=64,RT_CLIENT_UP=128,RT_CLIENT_DOWN=256,RT_ERROR=512 };
enum { RT_STATUS,RT_START,RT_STOP,RT_AP_ON,RT_AP_OFF,RT_RECONNECT,RT_CLIENTS,RT_CONFIG,RT_REBOOT,RT_WIFI_CONFIG };
typedef struct {uint8_t protocol;
uint16_t external,internal;
uint32_t host;
} clex_rt_port_t;
typedef struct {
 uint32_t version;
 int wan,backup,lan,auth,channel,max_clients,lease_minutes,probe_interval,probe_timeout;
 bool nat,dhcp,autostart,hidden,ota;
 char sta_ssid[33],sta_password[64],ap_ssid[33],ap_password[64],admin_user[25],admin_password[64];
 char lan_ip[16],lan_mask[16],dhcp_start[16],dhcp_end[16],lan_dns[16],probe_url[501];
 bool sta_static,eth_static;
 char sta_ip[16],sta_mask[16],sta_gateway[16],sta_dns[16],eth_ip[16],eth_mask[16],eth_gateway[16],eth_dns[16];
 unsigned port_count;
clex_rt_port_t ports[16];
} clex_rt_config_t;
typedef struct {bool running,wan_up,internet,ap_enabled;
uint32_t client_count,uptime;
char wan_ip[16],lan_ip[16],gateway[16],dns[48],wan_mac[18],lan_mac[18],active_wan[12],clients[1536],error[128];
} clex_rt_snapshot_t;
typedef struct {unsigned kind;
clex_rt_config_t*config;
} clex_rt_command_t;
static clex_rt_config_t clex_rt_config=@CONFIG@;
static clex_rt_snapshot_t clex_rt_value;
static SemaphoreHandle_t clex_rt_mutex;
static QueueHandle_t clex_rt_commands;
static esp_netif_t *clex_rt_sta,*clex_rt_ap,*clex_rt_lan,*clex_rt_wan;
static _Atomic(esp_netif_t*) clex_rt_dns_wan;
static void clex_rt_dns_task(void*unused);
static bool clex_rt_resolve(esp_netif_t*wan,const char*host,esp_ip4_addr_t*out,unsigned timeout);
static bool clex_rt_wifi_ready,clex_rt_wifi_initialized,clex_rt_wifi_handler_ready,clex_rt_running,clex_rt_ap_wanted=true,clex_rt_napt,clex_rt_sntp_owned;
static uint32_t clex_rt_events;
static int64_t clex_rt_started_at;
static atomic_uint clex_rt_wifi_events;
static httpd_handle_t clex_rt_http;
static esp_netif_t*clex_rt_ethernet(void){@ETH_NETIF@}
static esp_eth_handle_t clex_rt_eth_handle(void){@ETH_HANDLE@}
static void clex_rt_notify(unsigned flags,clex_rt_snapshot_t value);
static void clex_rt_web_start(void);
static void clex_rt_publish(unsigned flags){if(flags&(RT_WAN_UP|RT_WAN_DOWN|RT_IP)){@NETWORK_CHANGED@}
xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
clex_rt_events|=flags|RT_CHANGED;
xSemaphoreGive(clex_rt_mutex);
}
static void clex_rt_error(esp_err_t result,const char*context){if(!clex_rt_mutex){ESP_LOGE("CLEX_ROUTER","%s: %s",context,esp_err_to_name(result));return;}xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
snprintf(clex_rt_value.error,sizeof(clex_rt_value.error),"%s: %s",context,esp_err_to_name(result));
clex_rt_events|=RT_ERROR|RT_CHANGED;
xSemaphoreGive(clex_rt_mutex);
}
static uint32_t clex_rt_ip(const char*text){esp_ip4_addr_t ip={0};
esp_netif_str_to_ip4(text,&ip);
return ip.addr;
}
static bool clex_rt_subnet(uint32_t ip,uint32_t mask){uint32_t a=ntohl(ip),m=ntohl(mask),h=~m;
return a&&a>>24!=127&&a>>24<224&&m&&h>=3&&!(h&(h+1))&&(a&h)&&((a&h)!=h);
}
static bool clex_rt_overlap(const esp_netif_ip_info_t*a,const esp_netif_ip_info_t*b){uint32_t m=a->netmask.addr&b->netmask.addr;
return (a->ip.addr&m)==(b->ip.addr&m);
}
static bool clex_rt_validate(const clex_rt_config_t*c){
 const char*strings[]={c->sta_ssid,c->sta_password,c->ap_ssid,c->ap_password,c->admin_user,c->admin_password,c->lan_ip,c->lan_mask,c->dhcp_start,c->dhcp_end,c->lan_dns,c->probe_url,c->sta_ip,c->sta_mask,c->sta_gateway,c->sta_dns,c->eth_ip,c->eth_mask,c->eth_gateway,c->eth_dns};
 const size_t sizes[]={33,64,33,64,25,64,16,16,16,16,16,501,16,16,16,16,16,16,16,16};
 for(unsigned i=0;i<sizeof(strings)/sizeof(*strings);i++)if(!memchr(strings[i],0,sizes[i]))return false;

 if(c->lan!=@LAN_ROLE@)return false;
 if(c->ota&&!@HAS_OTA@)return false;
 uint32_t ip=clex_rt_ip(c->lan_ip),mask=clex_rt_ip(c->lan_mask),first=clex_rt_ip(c->dhcp_start),last=clex_rt_ip(c->dhcp_end);
 for(const char*u=c->admin_user;*u;u++)if(!((*u>='a'&&*u<='z')||(*u>='A'&&*u<='Z')||(*u>='0'&&*u<='9')||*u=='_'||*u=='-'))return false;
 if(c->version!=1||c->wan<1||c->wan>2||c->backup<0||c->backup>2||c->backup==c->wan||c->lan<1||c->lan>2||(c->lan==2&&(c->wan==2||c->backup==2)))return false;
 if((c->wan==2||c->backup==2||c->lan==2)&&!@HAS_ETH@)return false;
 if(!clex_rt_subnet(ip,mask)||c->channel<1||c->channel>11||c->max_clients<1||c->max_clients>@MAX_CLIENTS@||c->auth<0||c->auth>@MAX_AUTH@||c->lease_minutes<1||c->lease_minutes>10080||c->probe_interval<3000||c->probe_interval>300000||c->probe_timeout<500||c->probe_timeout>15000)return false;
 if(c->dhcp&&(!clex_rt_subnet(first,mask)||!clex_rt_subnet(last,mask)||(ip&mask)!=(first&mask)||(ip&mask)!=(last&mask)||ntohl(first)>ntohl(last)||(ntohl(ip)>=ntohl(first)&&ntohl(ip)<=ntohl(last))))return false;
 if(!strlen(c->ap_ssid)||strlen(c->ap_ssid)>32||strlen(c->ap_password)<8||strlen(c->ap_password)>63||!strlen(c->admin_user)||strlen(c->admin_password)<12||strlen(c->admin_password)>63||c->port_count>16)return false;
 if((c->wan==1||c->backup==1)&&(!strlen(c->sta_ssid)||strlen(c->sta_ssid)>32||(strlen(c->sta_password)&&strlen(c->sta_password)<8)))return false;
 if((strncmp(c->probe_url,"http://",7)&&strncmp(c->probe_url,"https://",8))||strchr(c->probe_url,'@')||strchr(c->probe_url,'\r')||strchr(c->probe_url,'\n'))return false;
 if(c->lan_dns[0]&&(!clex_rt_ip(c->lan_dns)||clex_rt_ip(c->lan_dns)==ip))return false;
 for(unsigned i=0;i<c->port_count;i++){const clex_rt_port_t*p=&c->ports[i];
if((p->protocol!=IPPROTO_TCP&&p->protocol!=IPPROTO_UDP)||!p->external||!p->internal||!clex_rt_subnet(p->host,mask)||(p->host&mask)!=(ip&mask)||p->host==ip)return false;
for(unsigned j=0;j<i;j++)if(p->protocol==c->ports[j].protocol&&p->external==c->ports[j].external)return false;
}
 const char*ips[]={c->sta_ip,c->eth_ip},*masks[]={c->sta_mask,c->eth_mask},*gates[]={c->sta_gateway,c->eth_gateway},*dns[]={c->sta_dns,c->eth_dns};
 bool enabled[]={c->sta_static&&(c->wan==1||c->backup==1),c->eth_static&&(c->wan==2||c->backup==2)};
 for(unsigned n=0;n<2;n++)if(enabled[n]){uint32_t a=clex_rt_ip(ips[n]),m=clex_rt_ip(masks[n]),g=clex_rt_ip(gates[n]);
if(!clex_rt_subnet(a,m)||!clex_rt_subnet(g,m)||(a&m)!=(g&m)||((a&m&mask)==(ip&m&mask))||(dns[n][0]&&!clex_rt_ip(dns[n])))return false;
}
 return true;
}
static esp_err_t clex_rt_save(const clex_rt_config_t*c){nvs_handle_t n;
esp_err_t e=nvs_open("@NAMESPACE@",NVS_READWRITE,&n);
if(e!=ESP_OK)return e;
e=nvs_set_blob(n,"config",c,sizeof(*c));
if(e==ESP_OK)e=nvs_set_u32(n,"baseline",@BASELINE@u);
if(e==ESP_OK)e=nvs_commit(n);
nvs_close(n);
return e;
}
static void clex_rt_load(void){nvs_handle_t n;
if(nvs_open("@NAMESPACE@",NVS_READONLY,&n)!=ESP_OK)return;
clex_rt_config_t*c=calloc(1,sizeof(*c));
if(c){size_t size=sizeof(*c);
uint32_t baseline=0;if(nvs_get_u32(n,"baseline",&baseline)==ESP_OK&&baseline==@BASELINE@u&&nvs_get_blob(n,"config",c,&size)==ESP_OK&&size==sizeof(*c)&&clex_rt_validate(c))clex_rt_config=*c;
free(c);
}nvs_close(n);
}
static clex_rt_snapshot_t __attribute__((unused)) clex_rt_read(void){if(!clex_rt_mutex)return (clex_rt_snapshot_t){0};xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
clex_rt_snapshot_t s=clex_rt_value;
xSemaphoreGive(clex_rt_mutex);
return s;
}
static void clex_rt_poll(void){if(!clex_rt_mutex)return;
xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
unsigned events=clex_rt_events;
clex_rt_snapshot_t s=clex_rt_value;
clex_rt_events=0;
xSemaphoreGive(clex_rt_mutex);
if(events)clex_rt_notify(events,s);
}
static void __attribute__((unused)) clex_rt_request(unsigned kind){clex_rt_command_t cmd={.kind=kind};
if(!clex_rt_commands||xQueueSend(clex_rt_commands,&cmd,0)!=pdTRUE)clex_rt_error(ESP_ERR_NO_MEM,"router command queue");
}
static void __attribute__((unused)) clex_rt_change_wifi(bool wan,const char*ssid,const char*password){
 if(!ssid||!password||strlen(ssid)<1||strlen(ssid)>32||strlen(password)>63||(!wan&&strlen(password)<8)||(wan&&strlen(password)&&strlen(password)<8)){clex_rt_error(ESP_ERR_INVALID_ARG,"Wi-Fi settings");
return;
}
 clex_rt_config_t*c=calloc(1,sizeof(*c));
if(!c){clex_rt_error(ESP_ERR_NO_MEM,"Wi-Fi settings");
return;
}c->wan=wan;
strlcpy(c->sta_ssid,ssid,sizeof(c->sta_ssid));
strlcpy(c->sta_password,password,sizeof(c->sta_password));
clex_rt_command_t cmd={.kind=RT_WIFI_CONFIG,.config=c};
if(!clex_rt_commands||xQueueSend(clex_rt_commands,&cmd,0)!=pdTRUE){free(c);
clex_rt_error(ESP_ERR_NO_MEM,"router command queue");
}
}
static void clex_rt_wifi_event(void*arg,esp_event_base_t base,int32_t id,void*data){(void)arg;
(void)data;
if(base!=WIFI_EVENT)return;
if(id==WIFI_EVENT_STA_DISCONNECTED)atomic_fetch_or(&clex_rt_wifi_events,1);
if(id==WIFI_EVENT_AP_STACONNECTED)atomic_fetch_or(&clex_rt_wifi_events,RT_CLIENT_UP);
if(id==WIFI_EVENT_AP_STADISCONNECTED)atomic_fetch_or(&clex_rt_wifi_events,RT_CLIENT_DOWN);
}
static esp_err_t clex_rt_address(esp_netif_t*n,bool is_static,const char*ip,const char*mask,const char*gateway,const char*dns){
 if(!n)return ESP_ERR_INVALID_ARG;
esp_err_t e=esp_netif_dhcpc_stop(n);
if(e!=ESP_OK&&e!=ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED)return e;
 esp_netif_ip_info_t info={0};
if(is_static){info.ip.addr=clex_rt_ip(ip);
info.netmask.addr=clex_rt_ip(mask);
info.gw.addr=clex_rt_ip(gateway);
}
 e=esp_netif_set_ip_info(n,&info);
if(e!=ESP_OK)return e;
 if(is_static){esp_netif_dns_info_t d={.ip.type=ESP_IPADDR_TYPE_V4};
d.ip.u_addr.ip4.addr=clex_rt_ip(dns[0]?dns:gateway);
return esp_netif_set_dns_info(n,ESP_NETIF_DNS_MAIN,&d);
}e=esp_netif_dhcpc_start(n);
return e==ESP_ERR_ESP_NETIF_DHCP_ALREADY_STARTED?ESP_OK:e;
}
static void clex_rt_portmaps(bool enable,uint32_t wan_ip){
 LOCK_TCPIP_CORE();
for(unsigned i=0;i<clex_rt_config.port_count;i++){clex_rt_port_t*p=&clex_rt_config.ports[i];
if(enable){if(!ip_portmap_add(p->protocol,wan_ip,p->external,p->host,p->internal))clex_rt_error(ESP_ERR_NO_MEM,"port forwarding");
}else ip_portmap_remove(p->protocol,p->external);
}UNLOCK_TCPIP_CORE();
}
static void clex_rt_route_off(void){
if(clex_rt_lan&&clex_rt_napt){clex_rt_portmaps(false,0);if(esp_netif_napt_disable(clex_rt_lan)!=ESP_OK){int index=esp_netif_get_netif_impl_index(clex_rt_lan);if(index>0){LOCK_TCPIP_CORE();ip_napt_enable_no(index-1,0);UNLOCK_TCPIP_CORE();}}}
clex_rt_napt=false;
clex_rt_wan=NULL;
atomic_store(&clex_rt_dns_wan,NULL);
}
static void clex_rt_clients(void){
 wifi_sta_list_t list={0};
esp_netif_pair_mac_ip_t addresses[@MAX_CLIENTS@]={0};
char clients[1536]="[]";
unsigned count=0;
 if(clex_rt_running&&clex_rt_ap_wanted&&clex_rt_config.lan==1&&esp_wifi_ap_get_sta_list(&list)==ESP_OK){
  count=list.num<@MAX_CLIENTS@?list.num:@MAX_CLIENTS@;
for(unsigned i=0;i<count;i++)memcpy(addresses[i].mac,list.sta[i].mac,6);
esp_netif_dhcps_get_clients_by_mac(clex_rt_lan,count,addresses);
cJSON*array=cJSON_CreateArray();
  for(unsigned i=0;i<count;i++){char mac[18],ip[16]="";
snprintf(mac,sizeof(mac),MACSTR,MAC2STR(list.sta[i].mac));
if(addresses[i].ip.addr)snprintf(ip,sizeof(ip),IPSTR,IP2STR(&addresses[i].ip));
cJSON*row=cJSON_CreateObject();
cJSON_AddStringToObject(row,"mac",mac);
cJSON_AddStringToObject(row,"ip",ip);
cJSON_AddNumberToObject(row,"rssi",list.sta[i].rssi);
cJSON_AddItemToArray(array,row);
}
  if(array){cJSON_PrintPreallocated(array,clients,sizeof(clients),false);
cJSON_Delete(array);
}
 }
 xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
clex_rt_value.client_count=count;
strlcpy(clex_rt_value.clients,clients,sizeof(clex_rt_value.clients));
xSemaphoreGive(clex_rt_mutex);
}
static esp_err_t clex_rt_lan_setup(void){
 clex_rt_lan=clex_rt_config.lan==1?clex_rt_ap:clex_rt_ethernet();
if(!clex_rt_lan)return ESP_ERR_INVALID_STATE;
 esp_netif_dhcps_stop(clex_rt_lan);
esp_netif_ip_info_t info={.ip.addr=clex_rt_ip(clex_rt_config.lan_ip),.gw.addr=clex_rt_ip(clex_rt_config.lan_ip),.netmask.addr=clex_rt_ip(clex_rt_config.lan_mask)};
 esp_err_t e=esp_netif_set_ip_info(clex_rt_lan,&info);
if(e!=ESP_OK)return e;
 dhcps_lease_t lease={.enable=true,.start_ip.addr=clex_rt_ip(clex_rt_config.dhcp_start),.end_ip.addr=clex_rt_ip(clex_rt_config.dhcp_end)};
 uint32_t minutes=clex_rt_config.lease_minutes;
uint8_t offer=OFFER_DNS;
 if((e=esp_netif_dhcps_option(clex_rt_lan,ESP_NETIF_OP_SET,ESP_NETIF_REQUESTED_IP_ADDRESS,&lease,sizeof(lease)))!=ESP_OK)return e;
 if((e=esp_netif_dhcps_option(clex_rt_lan,ESP_NETIF_OP_SET,ESP_NETIF_IP_ADDRESS_LEASE_TIME,&minutes,sizeof(minutes)))!=ESP_OK)return e;
 if((e=esp_netif_dhcps_option(clex_rt_lan,ESP_NETIF_OP_SET,ESP_NETIF_DOMAIN_NAME_SERVER,&offer,sizeof(offer)))!=ESP_OK)return e;
 esp_netif_dns_info_t dns={.ip.type=ESP_IPADDR_TYPE_V4};
dns.ip.u_addr.ip4.addr=clex_rt_ip(clex_rt_config.lan_ip);
if((e=esp_netif_set_dns_info(clex_rt_lan,ESP_NETIF_DNS_MAIN,&dns))!=ESP_OK)return e;
 if(clex_rt_config.dhcp&&(e=esp_netif_dhcps_start(clex_rt_lan))!=ESP_OK&&e!=ESP_ERR_ESP_NETIF_DHCP_ALREADY_STARTED)return e;
 xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
strlcpy(clex_rt_value.lan_ip,clex_rt_config.lan_ip,sizeof(clex_rt_value.lan_ip));
uint8_t mac[6];
if(esp_netif_get_mac(clex_rt_lan,mac)==ESP_OK)snprintf(clex_rt_value.lan_mac,sizeof(clex_rt_value.lan_mac),MACSTR,MAC2STR(mac));
xSemaphoreGive(clex_rt_mutex);
return ESP_OK;
}
static esp_err_t clex_rt_wifi_init(void){
 if(clex_rt_wifi_ready)return ESP_OK;
 if(!clex_rt_sta)clex_rt_sta=esp_netif_create_default_wifi_sta();
if(!clex_rt_ap)clex_rt_ap=esp_netif_create_default_wifi_ap();
if(!clex_rt_sta||!clex_rt_ap)return ESP_ERR_NO_MEM;
 wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
esp_err_t e=ESP_OK;
if(!clex_rt_wifi_initialized){e=esp_wifi_init(&init);if(e!=ESP_OK)return e;clex_rt_wifi_initialized=true;}
 if((e=esp_wifi_set_storage(WIFI_STORAGE_RAM))!=ESP_OK)return e;
 if(!clex_rt_wifi_handler_ready){if((e=esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,clex_rt_wifi_event,NULL))!=ESP_OK)return e;clex_rt_wifi_handler_ready=true;}
 clex_rt_wifi_ready=true;
return ESP_OK;
}
static esp_err_t clex_rt_start(void){
 if(clex_rt_running)return ESP_OK;
if(!clex_rt_validate(&clex_rt_config))return ESP_ERR_INVALID_ARG;
 esp_err_t e=clex_rt_wifi_init();
if(e!=ESP_OK)return e;
 bool sta=clex_rt_config.wan==1||clex_rt_config.backup==1,ap=clex_rt_config.lan==1&&clex_rt_ap_wanted;
 if((e=esp_wifi_set_mode(sta?(ap?WIFI_MODE_APSTA:WIFI_MODE_STA):(ap?WIFI_MODE_AP:WIFI_MODE_NULL)))!=ESP_OK)return e;
 wifi_config_t w={0};
memcpy(w.sta.ssid,clex_rt_config.sta_ssid,strlen(clex_rt_config.sta_ssid));
strlcpy((char*)w.sta.password,clex_rt_config.sta_password,sizeof(w.sta.password));
w.sta.pmf_cfg.capable=true;
 if(sta&&(e=esp_wifi_set_config(WIFI_IF_STA,&w))!=ESP_OK)return e;
 memset(&w,0,sizeof(w));
memcpy(w.ap.ssid,clex_rt_config.ap_ssid,strlen(clex_rt_config.ap_ssid));
w.ap.ssid_len=strlen(clex_rt_config.ap_ssid);
strlcpy((char*)w.ap.password,clex_rt_config.ap_password,sizeof(w.ap.password));
w.ap.channel=clex_rt_config.channel;
w.ap.max_connection=clex_rt_config.max_clients;
w.ap.ssid_hidden=clex_rt_config.hidden;
w.ap.authmode=clex_rt_config.auth==1?WIFI_AUTH_WPA3_PSK:clex_rt_config.auth==2?WIFI_AUTH_WPA2_WPA3_PSK:WIFI_AUTH_WPA2_PSK;
w.ap.pmf_cfg.capable=true;
w.ap.pmf_cfg.required=clex_rt_config.auth==1;
w.ap.sae_pwe_h2e=WPA3_SAE_PWE_BOTH;
 if(ap&&(e=esp_wifi_set_config(WIFI_IF_AP,&w))!=ESP_OK)return e;
 if((e=clex_rt_lan_setup())!=ESP_OK)return e;
 if(sta&&(e=clex_rt_address(clex_rt_sta,clex_rt_config.sta_static,clex_rt_config.sta_ip,clex_rt_config.sta_mask,clex_rt_config.sta_gateway,clex_rt_config.sta_dns))!=ESP_OK)return e;
 if(clex_rt_config.lan!=2&&clex_rt_ethernet()&&(e=clex_rt_address(clex_rt_ethernet(),clex_rt_config.eth_static,clex_rt_config.eth_ip,clex_rt_config.eth_mask,clex_rt_config.eth_gateway,clex_rt_config.eth_dns))!=ESP_OK)return e;
 if((e=esp_wifi_start())!=ESP_OK)return e;
 esp_eth_handle_t eth=clex_rt_eth_handle();
if(eth){e=esp_eth_start(eth);
if(e!=ESP_OK&&e!=ESP_ERR_INVALID_STATE){esp_wifi_stop();
return e;
}}
 clex_rt_running=true;
clex_rt_started_at=esp_timer_get_time();
if(sta)esp_wifi_connect();
 xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
clex_rt_value.running=true;
clex_rt_value.ap_enabled=ap;
clex_rt_value.error[0]=0;
xSemaphoreGive(clex_rt_mutex);
clex_rt_web_start();
clex_rt_publish(RT_STARTED);
return ESP_OK;
}
static void clex_rt_stop(void){
 clex_rt_running=false;
@NETWORK_CHANGED@
if(clex_rt_sntp_owned){esp_sntp_stop();clex_rt_sntp_owned=false;}
clex_rt_route_off();
if(clex_rt_lan)esp_netif_dhcps_stop(clex_rt_lan);
if(clex_rt_wifi_ready)esp_wifi_stop();
esp_eth_handle_t eth=clex_rt_eth_handle();
if(eth)esp_eth_stop(eth);
 if(clex_rt_http){httpd_stop(clex_rt_http);
clex_rt_http=NULL;
}
 xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
unsigned flags=(clex_rt_value.wan_up?RT_WAN_DOWN:0)|(clex_rt_value.internet?RT_INTERNET_DOWN:0);
clex_rt_value=(clex_rt_snapshot_t){0};
strlcpy(clex_rt_value.clients,"[]",sizeof(clex_rt_value.clients));
clex_rt_events|=flags|RT_CHANGED;
xSemaphoreGive(clex_rt_mutex);
}
static bool clex_rt_probe(esp_netif_t*netif){
 struct ifreq interface={0};
if(esp_netif_get_netif_impl_name(netif,interface.ifr_name)!=ESP_OK)return false;
 struct http_parser_url parsed={0};
 if(http_parser_parse_url(clex_rt_config.probe_url,strlen(clex_rt_config.probe_url),0,&parsed)||!(parsed.field_set&(1<<UF_HOST))||parsed.field_data[UF_HOST].len>253)return false;
 char host[254]={0},ip_text[16],path[502]="/",url[800],host_header[275];
 memcpy(host,clex_rt_config.probe_url+parsed.field_data[UF_HOST].off,parsed.field_data[UF_HOST].len);
 int64_t deadline=esp_timer_get_time()+(int64_t)clex_rt_config.probe_timeout*1000;
 esp_ip4_addr_t address={0};if(!clex_rt_resolve(netif,host,&address,clex_rt_config.probe_timeout))return false;esp_ip4addr_ntoa(&address,ip_text,sizeof(ip_text));
 bool secure=!strncmp(clex_rt_config.probe_url,"https://",8);unsigned port=parsed.field_set&(1<<UF_PORT)?parsed.port:secure?443:80;
 if(parsed.field_set&(1<<UF_PATH)){size_t size=strlen(clex_rt_config.probe_url+parsed.field_data[UF_PATH].off);if(size>=sizeof(path))return false;memcpy(path,clex_rt_config.probe_url+parsed.field_data[UF_PATH].off,size+1);}
 else if(parsed.field_set&(1<<UF_QUERY))snprintf(path,sizeof(path),"/?%.*s",parsed.field_data[UF_QUERY].len,clex_rt_config.probe_url+parsed.field_data[UF_QUERY].off);
 snprintf(url,sizeof(url),"%s://%s:%u%s",secure?"https":"http",ip_text,port,path);snprintf(host_header,sizeof(host_header),"%s:%u",host,port);
 int remaining=(deadline-esp_timer_get_time())/1000;if(remaining<=0)return false;
 esp_http_client_config_t config={.url=url,.common_name=host,.method=HTTP_METHOD_HEAD,.timeout_ms=remaining,.crt_bundle_attach=esp_crt_bundle_attach,.if_name=&interface,.disable_auto_redirect=true,.buffer_size=512,.buffer_size_tx=512};
 esp_http_client_handle_t h=esp_http_client_init(&config);
if(!h)return false;
esp_http_client_set_header(h,"Host",host_header);
esp_err_t e=esp_http_client_perform(h);
int status=esp_http_client_get_status_code(h);
esp_http_client_cleanup(h);
return e==ESP_OK&&status>=200&&status<400;
}
static int clex_rt_choose_wan(const bool up[2],const bool healthy[2]){return up[0]&&healthy[0]?0:up[1]&&healthy[1]?1:up[0]?0:up[1]?1:-1;}
static void clex_rt_update(bool probe){
 static bool healthy[2];
static uint32_t checked_ip[2];
 esp_netif_t*candidates[2]={clex_rt_config.wan==1?clex_rt_sta:clex_rt_ethernet(),clex_rt_config.backup==1?clex_rt_sta:clex_rt_config.backup==2?clex_rt_ethernet():NULL};
 esp_netif_ip_info_t info[2]={0},local={0};
esp_netif_get_ip_info(clex_rt_lan,&local);
bool up[2]={0},online[2]={0};
 for(int i=0;i<2;i++){if(candidates[i]&&esp_netif_is_netif_up(candidates[i])&&esp_netif_get_ip_info(candidates[i],&info[i])==ESP_OK&&info[i].ip.addr&&!clex_rt_overlap(&info[i],&local)){up[i]=true;
if(checked_ip[i]!=info[i].ip.addr)healthy[i]=false;
if(probe){healthy[i]=clex_rt_probe(candidates[i]);
checked_ip[i]=info[i].ip.addr;
}online[i]=healthy[i];
}else{healthy[i]=false;
checked_ip[i]=0;
if(info[i].ip.addr&&clex_rt_overlap(&info[i],&local))clex_rt_error(ESP_ERR_INVALID_STATE,"WAN/LAN subnet overlap");
}}
 int selected=clex_rt_choose_wan(up,online);
esp_netif_t*wan=selected<0?NULL:candidates[selected];
 clex_rt_snapshot_t previous=clex_rt_read();
uint32_t old_ip=clex_rt_ip(previous.wan_ip);
bool changed=wan!=clex_rt_wan||(selected>=0&&old_ip!=info[selected].ip.addr);
 if(changed||(wan&&clex_rt_config.nat&&!clex_rt_napt&&esp_netif_is_netif_up(clex_rt_lan))||(!esp_netif_is_netif_up(clex_rt_lan)&&clex_rt_napt)){clex_rt_route_off();
if(wan){esp_err_t e=esp_netif_set_default_netif(wan);
if(e!=ESP_OK)clex_rt_error(e,"WAN route");
else{clex_rt_wan=wan;
atomic_store(&clex_rt_dns_wan,wan);
if(!esp_sntp_enabled()){esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);esp_sntp_setservername(0,"pool.ntp.org");esp_sntp_init();clex_rt_sntp_owned=true;}
if(clex_rt_config.nat&&esp_netif_is_netif_up(clex_rt_lan)){e=esp_netif_napt_enable(clex_rt_lan);
if(e==ESP_OK){clex_rt_napt=true;
clex_rt_portmaps(true,info[selected].ip.addr);
}else clex_rt_error(e,"NAPT");
}}}}
 clex_rt_clients();
unsigned flags=0;
 xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
clex_rt_snapshot_t*s=&clex_rt_value;
s->wan_up=wan!=NULL;
s->internet=selected>=0&&(probe?online[selected]:previous.internet&&!changed);
s->uptime=(esp_timer_get_time()-clex_rt_started_at)/1000000;
 if(s->wan_up){snprintf(s->wan_ip,sizeof(s->wan_ip),IPSTR,IP2STR(&info[selected].ip));
snprintf(s->gateway,sizeof(s->gateway),IPSTR,IP2STR(&info[selected].gw));
uint8_t mac[6];
if(esp_netif_get_mac(wan,mac)==ESP_OK)snprintf(s->wan_mac,sizeof(s->wan_mac),MACSTR,MAC2STR(mac));
strlcpy(s->active_wan,wan==clex_rt_sta?"Wi-Fi":"Ethernet",sizeof(s->active_wan));
}
 else{s->wan_ip[0]=s->gateway[0]=s->dns[0]=s->wan_mac[0]=s->active_wan[0]=0;
}
 if(s->wan_up!=previous.wan_up)flags|=s->wan_up?RT_WAN_UP:RT_WAN_DOWN;
if(changed)flags|=RT_IP;
if(s->internet!=previous.internet)flags|=s->internet?RT_INTERNET_UP:RT_INTERNET_DOWN;
 xSemaphoreGive(clex_rt_mutex);
 if(wan){esp_netif_dns_info_t dns={0};
if(esp_netif_get_dns_info(wan,ESP_NETIF_DNS_MAIN,&dns)==ESP_OK&&dns.ip.type==ESP_IPADDR_TYPE_V4&&dns.ip.u_addr.ip4.addr){xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
esp_ip4addr_ntoa(&dns.ip.u_addr.ip4,clex_rt_value.dns,sizeof(clex_rt_value.dns));
xSemaphoreGive(clex_rt_mutex);

}}
 clex_rt_publish(flags);
}
static void clex_rt_task(void*unused){
 (void)unused;
int64_t next_probe=0,next_connect=0;
clex_rt_command_t cmd;
 if(!clex_rt_config.autostart)clex_rt_stop();
else {esp_err_t e=clex_rt_start();
if(e!=ESP_OK){clex_rt_stop();
clex_rt_error(e,"router start");
}}
 for(;;){
  if(xQueueReceive(clex_rt_commands,&cmd,pdMS_TO_TICKS(250))==pdTRUE){esp_err_t e=ESP_OK;
   if(cmd.kind==RT_START)e=clex_rt_start();
else if(cmd.kind==RT_STOP)clex_rt_stop();
   else if(cmd.kind==RT_RECONNECT){if(clex_rt_config.wan==1||clex_rt_config.backup==1){esp_wifi_disconnect();
next_connect=0;
}if(clex_rt_ethernet()){esp_eth_handle_t h=clex_rt_eth_handle();
esp_eth_stop(h);
esp_eth_start(h);
}next_probe=0;
}
   else if(cmd.kind==RT_AP_ON||cmd.kind==RT_AP_OFF){if(clex_rt_config.lan!=1)e=ESP_ERR_NOT_SUPPORTED;
else{clex_rt_ap_wanted=cmd.kind==RT_AP_ON;
bool restart=clex_rt_running;
clex_rt_stop();
if(restart)e=clex_rt_start();
}}
   else if((cmd.kind==RT_CONFIG||cmd.kind==RT_WIFI_CONFIG)&&cmd.config){
    if(cmd.kind==RT_WIFI_CONFIG){bool wan=cmd.config->wan;
char ssid[33],password[64];
strlcpy(ssid,cmd.config->sta_ssid,sizeof(ssid));
strlcpy(password,cmd.config->sta_password,sizeof(password));
*cmd.config=clex_rt_config;
strlcpy(wan?cmd.config->sta_ssid:cmd.config->ap_ssid,ssid,33);
strlcpy(wan?cmd.config->sta_password:cmd.config->ap_password,password,64);
}
    if(!clex_rt_validate(cmd.config))e=ESP_ERR_INVALID_ARG;
else if((e=clex_rt_save(cmd.config))==ESP_OK){clex_rt_stop();
xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
clex_rt_config=*cmd.config;
xSemaphoreGive(clex_rt_mutex);
e=clex_rt_start();
next_probe=0;
}free(cmd.config);
}
   else if(cmd.kind==RT_REBOOT){vTaskDelay(pdMS_TO_TICKS(300));
esp_restart();
}
   if(e!=ESP_OK){if(!clex_rt_running)clex_rt_stop();clex_rt_error(e,"router command");}
if(clex_rt_running)clex_rt_update(false);
  }
  unsigned wifi=atomic_exchange(&clex_rt_wifi_events,0);
if(wifi&(RT_CLIENT_UP|RT_CLIENT_DOWN))clex_rt_publish(wifi&(RT_CLIENT_UP|RT_CLIENT_DOWN));
  if(clex_rt_running){int64_t now=esp_timer_get_time();
if(now>=next_connect&&(clex_rt_config.wan==1||clex_rt_config.backup==1)){wifi_ap_record_t record;
if(esp_wifi_sta_get_ap_info(&record)!=ESP_OK)esp_wifi_connect();
next_connect=now+5000000;
}
   {bool probe=now>=next_probe;
clex_rt_update(probe);
if(probe)next_probe=esp_timer_get_time()+(int64_t)clex_rt_config.probe_interval*1000;
}
  }
 }
}
static void clex_rt_initialize(void){
 clex_rt_mutex=xSemaphoreCreateMutex();
clex_rt_commands=xQueueCreate(8,sizeof(clex_rt_command_t));
if(!clex_rt_mutex||!clex_rt_commands){ESP_LOGE("CLEX_ROUTER","Cannot allocate controller");
abort();
}
 esp_err_t e=nvs_flash_init();
if(e!=ESP_OK){clex_rt_error(e,"NVS init");
return;
}clex_rt_load();
 if((e=esp_netif_init())!=ESP_OK){clex_rt_error(e,"netif init");
return;
}e=esp_event_loop_create_default();
if(e!=ESP_OK&&e!=ESP_ERR_INVALID_STATE){clex_rt_error(e,"event loop");
return;
}
 if(xTaskCreate(clex_rt_dns_task,"clex_dns",8192,NULL,3,NULL)!=pdPASS)clex_rt_error(ESP_ERR_NO_MEM,"DNS task");
 if(xTaskCreate(clex_rt_task,"clex_router",12288,NULL,4,NULL)!=pdPASS)clex_rt_error(ESP_ERR_NO_MEM,"router task");
}
`;
