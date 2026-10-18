export const ROUTER_WEB=String.raw`
static const char clex_rt_page[]= @PAGE@;
static bool clex_rt_auth_throttled(uint32_t address,bool failed){
 // Only incorrect credentials consume a per-client retry interval.
 static struct {uint32_t address;int64_t next;} attempts[16];
 unsigned slot=0;
 bool found=false;
 for(unsigned i=0;i<sizeof(attempts)/sizeof(*attempts);i++){
 if(attempts[i].address==address){slot=i;found=true;break;}
 if(attempts[i].next<attempts[slot].next)slot=i;
 }
 if(!failed){if(found)attempts[slot].next=0;return false;}
 int64_t now=esp_timer_get_time();
 if(found&&now<attempts[slot].next)return true;
 attempts[slot].address=address;
 attempts[slot].next=now+1000000;
 return false;
}
static bool clex_rt_authorize(httpd_req_t*r){
 httpd_resp_set_hdr(r,"Cache-Control","no-store");
 struct sockaddr_storage peer={0};
socklen_t size=sizeof(peer);
int sock=httpd_req_to_sockfd(r);
 uint32_t address=0;
bool ipv4=false;
if(!getpeername(sock,(struct sockaddr*)&peer,&size)){
 if(peer.ss_family==AF_INET&&size>=sizeof(struct sockaddr_in)){
address=((struct sockaddr_in*)&peer)->sin_addr.s_addr;
ipv4=true;
}
#if CONFIG_LWIP_IPV6
 // ESP-IDF's dual-stack HTTP listener reports IPv4 clients as ::ffff:a.b.c.d.
 else if(peer.ss_family==AF_INET6&&size>=sizeof(struct sockaddr_in6)){
const struct sockaddr_in6*v6=(const struct sockaddr_in6*)&peer;
if(IN6_IS_ADDR_V4MAPPED(&v6->sin6_addr)){
memcpy(&address,&v6->sin6_addr.s6_addr[12],sizeof(address));
ipv4=true;
}
}
#endif
}
 if(!ipv4){httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"LAN only");
return false;
}
clex_rt_config_t c;
xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
c=clex_rt_config;
xSemaphoreGive(clex_rt_mutex);
 uint32_t mask=clex_rt_ip(c.lan_mask);
if((address&mask)!=(clex_rt_ip(c.lan_ip)&mask)){httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"LAN only");
return false;
}
 char supplied[200],plain[100],encoded[160],expected[168];
size_t written=0;
 snprintf(plain,sizeof(plain),"%s:%s",c.admin_user,c.admin_password);
mbedtls_base64_encode((unsigned char*)encoded,sizeof(encoded)-1,&written,(unsigned char*)plain,strlen(plain));
encoded[written]=0;
snprintf(expected,sizeof(expected),"Basic %s",encoded);
 bool credentials=httpd_req_get_hdr_value_len(r,"Authorization")>0;
 bool ok=httpd_req_get_hdr_value_str(r,"Authorization",supplied,sizeof(supplied))==ESP_OK&&strlen(supplied)==strlen(expected);
unsigned difference=0;
if(ok)for(size_t i=0;i<strlen(expected);i++)difference|=(unsigned char)supplied[i]^(unsigned char)expected[i];
ok=ok&&!difference;
 memset(plain,0,sizeof(plain));
memset(encoded,0,sizeof(encoded));
memset(expected,0,sizeof(expected));
memset(c.admin_password,0,sizeof(c.admin_password));
 if(!ok){
if(credentials&&clex_rt_auth_throttled(address,true)){
httpd_resp_set_status(r,"429 Too Many Requests");
httpd_resp_set_hdr(r,"Retry-After","1");
httpd_resp_send(r,"Too many incorrect login attempts. Retry in 1 second.",HTTPD_RESP_USE_STRLEN);
return false;
}
httpd_resp_set_status(r,"401 Unauthorized");
httpd_resp_set_hdr(r,"WWW-Authenticate","Basic realm=\"CLEX Flow Router\", charset=\"UTF-8\"");
httpd_resp_send(r,"Authentication required",HTTPD_RESP_USE_STRLEN);
return false;
}
 clex_rt_auth_throttled(address,false);
httpd_resp_set_hdr(r,"X-Content-Type-Options","nosniff");
httpd_resp_set_hdr(r,"X-Frame-Options","DENY");
 if(r->method!=HTTP_GET){char origin[160],host[120];
if(httpd_req_get_hdr_value_len(r,"Origin")){if(httpd_req_get_hdr_value_str(r,"Origin",origin,sizeof(origin))!=ESP_OK||httpd_req_get_hdr_value_str(r,"Host",host,sizeof(host))!=ESP_OK||strncmp(origin,"http://",7)||strcmp(origin+7,host)){httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"Origin rejected");
return false;
}}}
 return true;
}
static esp_err_t clex_rt_json(httpd_req_t*r,cJSON*root){if(!root)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Memory");
char*text=cJSON_PrintUnformatted(root);
cJSON_Delete(root);
if(!text)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Memory");
httpd_resp_set_type(r,"application/json");
esp_err_t e=httpd_resp_send(r,text,HTTPD_RESP_USE_STRLEN);
free(text);
return e;
}
static esp_err_t clex_rt_home(httpd_req_t*r){if(!clex_rt_authorize(r))return ESP_OK;
httpd_resp_set_type(r,"text/html; charset=utf-8");
return httpd_resp_send(r,clex_rt_page,HTTPD_RESP_USE_STRLEN);
}
static esp_err_t clex_rt_status_web(httpd_req_t*r){
 if(!clex_rt_authorize(r))return ESP_OK;
clex_rt_snapshot_t s=clex_rt_read();
cJSON*o=cJSON_CreateObject();
if(!o)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Memory");
 cJSON_AddBoolToObject(o,"running",s.running);
cJSON_AddBoolToObject(o,"wanUp",s.wan_up);
cJSON_AddBoolToObject(o,"internet",s.internet);
cJSON_AddBoolToObject(o,"apEnabled",s.ap_enabled);
cJSON_AddStringToObject(o,"wanIp",s.wan_ip);
cJSON_AddStringToObject(o,"lanIp",s.lan_ip);
cJSON_AddStringToObject(o,"gateway",s.gateway);
cJSON_AddStringToObject(o,"dns",s.dns);
cJSON_AddStringToObject(o,"wanMac",s.wan_mac);
cJSON_AddStringToObject(o,"lanMac",s.lan_mac);
cJSON_AddStringToObject(o,"activeWan",s.active_wan);
cJSON_AddNumberToObject(o,"uptime",s.uptime);
cJSON_AddStringToObject(o,"error",s.error);
cJSON_AddItemToObject(o,"clients",cJSON_Parse(s.clients));
return clex_rt_json(r,o);
}
// Field descriptors are shared by GET and POST; passwords are write-only.
typedef struct {const char*name;
size_t offset,size;
bool secret;
} clex_rt_string_field_t;
#define RT_STR(name,field,secret) {name,offsetof(clex_rt_config_t,field),sizeof(((clex_rt_config_t*)0)->field),secret}
static const clex_rt_string_field_t clex_rt_string_fields[]={
 RT_STR("staSsid",sta_ssid,false),RT_STR("staPassword",sta_password,true),RT_STR("apSsid",ap_ssid,false),RT_STR("apPassword",ap_password,true),RT_STR("adminUser",admin_user,false),RT_STR("adminPassword",admin_password,true),RT_STR("lanIp",lan_ip,false),RT_STR("lanMask",lan_mask,false),RT_STR("dhcpStart",dhcp_start,false),RT_STR("dhcpEnd",dhcp_end,false),RT_STR("lanDns",lan_dns,false),RT_STR("probeUrl",probe_url,false),RT_STR("staIp",sta_ip,false),RT_STR("staMask",sta_mask,false),RT_STR("staGateway",sta_gateway,false),RT_STR("staDns",sta_dns,false),RT_STR("ethIp",eth_ip,false),RT_STR("ethMask",eth_mask,false),RT_STR("ethGateway",eth_gateway,false),RT_STR("ethDns",eth_dns,false)
};
typedef struct {const char*name;
size_t offset;
int min,max;
} clex_rt_int_field_t;
#define RT_INT(name,field,min,max) {name,offsetof(clex_rt_config_t,field),min,max}
static const clex_rt_int_field_t clex_rt_int_fields[]={RT_INT("wan",wan,1,2),RT_INT("backup",backup,0,2),RT_INT("lan",lan,1,2),RT_INT("auth",auth,0,@MAX_AUTH@),RT_INT("channel",channel,1,11),RT_INT("maxClients",max_clients,1,@MAX_CLIENTS@),RT_INT("leaseMinutes",lease_minutes,1,10080),RT_INT("probeInterval",probe_interval,3000,300000),RT_INT("probeTimeout",probe_timeout,500,15000)};
typedef struct {const char*name;
size_t offset;
} clex_rt_bool_field_t;
#define RT_BOOL(name,field) {name,offsetof(clex_rt_config_t,field)}
static const clex_rt_bool_field_t clex_rt_bool_fields[]={RT_BOOL("nat",nat),RT_BOOL("dhcp",dhcp),RT_BOOL("autostart",autostart),RT_BOOL("hidden",hidden),RT_BOOL("ota",ota),RT_BOOL("staStatic",sta_static),RT_BOOL("ethStatic",eth_static)};
static esp_err_t clex_rt_config_web(httpd_req_t*r){
 if(!clex_rt_authorize(r))return ESP_OK;
clex_rt_config_t c;
xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
c=clex_rt_config;
xSemaphoreGive(clex_rt_mutex);
cJSON*o=cJSON_CreateObject();
if(!o)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Memory");
 for(unsigned i=0;i<sizeof(clex_rt_string_fields)/sizeof(*clex_rt_string_fields);i++){const clex_rt_string_field_t*f=&clex_rt_string_fields[i];
if(!f->secret)cJSON_AddStringToObject(o,f->name,(char*)&c+f->offset);
}
 for(unsigned i=0;i<sizeof(clex_rt_int_fields)/sizeof(*clex_rt_int_fields);i++){const clex_rt_int_field_t*f=&clex_rt_int_fields[i];
cJSON_AddNumberToObject(o,f->name,*(int*)((char*)&c+f->offset));
}
 for(unsigned i=0;i<sizeof(clex_rt_bool_fields)/sizeof(*clex_rt_bool_fields);i++){const clex_rt_bool_field_t*f=&clex_rt_bool_fields[i];
cJSON_AddBoolToObject(o,f->name,*(bool*)((char*)&c+f->offset));
}
 cJSON*a=cJSON_AddArrayToObject(o,"portMappings");
for(unsigned i=0;i<c.port_count;i++){cJSON*p=cJSON_CreateObject();
char host[16];
esp_ip4_addr_t ip={.addr=c.ports[i].host};
esp_ip4addr_ntoa(&ip,host,sizeof(host));
cJSON_AddStringToObject(p,"protocol",c.ports[i].protocol==IPPROTO_TCP?"tcp":"udp");
cJSON_AddStringToObject(p,"host",host);
cJSON_AddNumberToObject(p,"externalPort",c.ports[i].external);
cJSON_AddNumberToObject(p,"internalPort",c.ports[i].internal);
cJSON_AddItemToArray(a,p);
}
 cJSON*cap=cJSON_AddObjectToObject(o,"capabilities");cJSON_AddBoolToObject(cap,"ethernet",@HAS_ETH@);cJSON_AddBoolToObject(cap,"ota",@HAS_OTA@);cJSON_AddNumberToObject(cap,"maxClients",@MAX_CLIENTS@);cJSON_AddNumberToObject(cap,"maxAuth",@MAX_AUTH@);
 return clex_rt_json(r,o);
}
static cJSON*clex_rt_body(httpd_req_t*r){char type[80];
if(r->content_len<1||r->content_len>12000||httpd_req_get_hdr_value_str(r,"Content-Type",type,sizeof(type))!=ESP_OK||strncmp(type,"application/json",16))return NULL;
char*b=calloc(1,r->content_len+1);
if(!b)return NULL;
int offset=0;
while(offset<r->content_len){int got=httpd_req_recv(r,b+offset,r->content_len-offset);
if(got<=0){free(b);
return NULL;
}offset+=got;
}cJSON*root=cJSON_ParseWithLength(b,offset);
free(b);
return root;
}
static bool clex_rt_parse_config(cJSON*o,clex_rt_config_t*c){
 if(!cJSON_IsObject(o))return false;
 for(unsigned i=0;i<sizeof(clex_rt_string_fields)/sizeof(*clex_rt_string_fields);i++){const clex_rt_string_field_t*f=&clex_rt_string_fields[i];
const cJSON*v=cJSON_GetObjectItemCaseSensitive(o,f->name);
if(!v)continue;
if(!cJSON_IsString(v)||strlen(v->valuestring)>=f->size)return false;
if(f->secret&&!v->valuestring[0])continue;
strlcpy((char*)c+f->offset,v->valuestring,f->size);
}
 for(unsigned i=0;i<sizeof(clex_rt_int_fields)/sizeof(*clex_rt_int_fields);i++){const clex_rt_int_field_t*f=&clex_rt_int_fields[i];
const cJSON*v=cJSON_GetObjectItemCaseSensitive(o,f->name);
if(!v)continue;
if(!cJSON_IsNumber(v)||v->valuedouble!=v->valueint||v->valueint<f->min||v->valueint>f->max)return false;
*(int*)((char*)c+f->offset)=v->valueint;
}
 for(unsigned i=0;i<sizeof(clex_rt_bool_fields)/sizeof(*clex_rt_bool_fields);i++){const clex_rt_bool_field_t*f=&clex_rt_bool_fields[i];
const cJSON*v=cJSON_GetObjectItemCaseSensitive(o,f->name);
if(!v)continue;
if(!cJSON_IsBool(v))return false;
*(bool*)((char*)c+f->offset)=cJSON_IsTrue(v);
}
 cJSON*a=cJSON_GetObjectItemCaseSensitive(o,"portMappings");
if(a){if(!cJSON_IsArray(a)||cJSON_GetArraySize(a)>16)return false;
c->port_count=0;
cJSON*p;
 cJSON_ArrayForEach(p,a){cJSON*protocol=cJSON_GetObjectItemCaseSensitive(p,"protocol"),*host=cJSON_GetObjectItemCaseSensitive(p,"host"),*external=cJSON_GetObjectItemCaseSensitive(p,"externalPort"),*internal=cJSON_GetObjectItemCaseSensitive(p,"internalPort");
if(!cJSON_IsString(protocol)||!cJSON_IsString(host)||!cJSON_IsNumber(external)||!cJSON_IsNumber(internal)||external->valuedouble!=external->valueint||internal->valuedouble!=internal->valueint||external->valueint<1||external->valueint>65535||internal->valueint<1||internal->valueint>65535||(strcmp(protocol->valuestring,"tcp")&&strcmp(protocol->valuestring,"udp")))return false;
c->ports[c->port_count++]=(clex_rt_port_t){.protocol=!strcmp(protocol->valuestring,"tcp")?IPPROTO_TCP:IPPROTO_UDP,.external=external->valueint,.internal=internal->valueint,.host=clex_rt_ip(host->valuestring)};
}}
 return clex_rt_validate(c);
}
static esp_err_t clex_rt_config_post(httpd_req_t*r){
 if(!clex_rt_authorize(r))return ESP_OK;
cJSON*o=clex_rt_body(r);
clex_rt_config_t*c=malloc(sizeof(*c));
if(!c){cJSON_Delete(o);
return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Memory");
}xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
*c=clex_rt_config;
xSemaphoreGive(clex_rt_mutex);
 bool valid=clex_rt_parse_config(o,c);
cJSON_Delete(o);
if(!valid){free(c);
return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid network configuration");
}
 clex_rt_command_t cmd={.kind=RT_CONFIG,.config=c};
if(xQueueSend(clex_rt_commands,&cmd,0)!=pdTRUE){free(c);
return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Command queue full");
}httpd_resp_set_status(r,"202 Accepted");
return httpd_resp_send(r,"Configuration queued; reconnect to LAN if addresses changed",HTTPD_RESP_USE_STRLEN);
}
static esp_err_t clex_rt_command_web(httpd_req_t*r){
 if(!clex_rt_authorize(r))return ESP_OK;
cJSON*o=clex_rt_body(r),*kind=cJSON_GetObjectItemCaseSensitive(o,"action");
if(!cJSON_IsString(kind)){cJSON_Delete(o);
return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Action required");
}
 unsigned command=!strcmp(kind->valuestring,"reconnect")?RT_RECONNECT:!strcmp(kind->valuestring,"restart")?RT_REBOOT:!strcmp(kind->valuestring,"clients")?RT_CLIENTS:!strcmp(kind->valuestring,"apOn")?RT_AP_ON:!strcmp(kind->valuestring,"apOff")?RT_AP_OFF:999;
cJSON_Delete(o);
if(command==999)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Unknown action");
clex_rt_command_t cmd={.kind=command};
if(xQueueSend(clex_rt_commands,&cmd,0)!=pdTRUE)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Command queue full");
return httpd_resp_send(r,"Command queued",HTTPD_RESP_USE_STRLEN);
}
static esp_err_t clex_rt_ota_web(httpd_req_t*r){
 if(!clex_rt_authorize(r))return ESP_OK;
bool enabled;
xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
enabled=clex_rt_config.ota;
xSemaphoreGive(clex_rt_mutex);
if(!enabled)return httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"OTA disabled");
 const esp_partition_t*partition=esp_ota_get_next_update_partition(NULL);
if(!partition||r->content_len<1||r->content_len>partition->size)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Firmware does not fit OTA partition");
 esp_ota_handle_t update;
esp_err_t e=esp_ota_begin(partition,r->content_len,&update);
if(e!=ESP_OK)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"OTA begin failed");
char buffer[2048];
size_t left=r->content_len;
 while(left){int n=httpd_req_recv(r,buffer,left<sizeof(buffer)?left:sizeof(buffer));
if(n<=0||(e=esp_ota_write(update,buffer,n))!=ESP_OK){esp_ota_abort(update);
return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"OTA transfer failed");
}left-=n;
}
 if(esp_ota_end(update)!=ESP_OK||esp_ota_set_boot_partition(partition)!=ESP_OK)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Firmware validation failed");
httpd_resp_send(r,"Firmware accepted. Restarting.",HTTPD_RESP_USE_STRLEN);
clex_rt_request(RT_REBOOT);
return ESP_OK;
}
static void clex_rt_web_start(void){
 if(clex_rt_http)return;
httpd_config_t config=HTTPD_DEFAULT_CONFIG();
config.stack_size=12288;
config.max_uri_handlers=8;
config.max_open_sockets=4;
config.lru_purge_enable=true;
config.recv_wait_timeout=5;
config.send_wait_timeout=5;
 esp_err_t e=httpd_start(&clex_rt_http,&config);
if(e!=ESP_OK){clex_rt_error(e,"admin server");
return;
}
 const httpd_uri_t routes[]={
 {.uri="/",.method=HTTP_GET,.handler=clex_rt_home},{.uri="/api/status",.method=HTTP_GET,.handler=clex_rt_status_web},{.uri="/api/config",.method=HTTP_GET,.handler=clex_rt_config_web},{.uri="/api/config",.method=HTTP_POST,.handler=clex_rt_config_post},{.uri="/api/command",.method=HTTP_POST,.handler=clex_rt_command_web},{.uri="/api/ota",.method=HTTP_POST,.handler=clex_rt_ota_web}};
 for(unsigned i=0;i<sizeof(routes)/sizeof(*routes);i++)if((e=httpd_register_uri_handler(clex_rt_http,&routes[i]))!=ESP_OK){httpd_stop(clex_rt_http);
clex_rt_http=NULL;
clex_rt_error(e,"admin routes");
break;
}
}
`;
