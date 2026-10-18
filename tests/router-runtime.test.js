import test from 'node:test';
import {runHostC} from './host-c.js';
import {ROUTER_RUNTIME} from '../src/firmware/drivers/esp-idf/router-runtime.js';
import {ROUTER_WEB} from '../src/firmware/drivers/esp-idf/router-web.js';
import {ROUTER_DNS} from '../src/firmware/drivers/esp-idf/router-dns.js';

test('actual firmware IPv4 policy rejects invalid LAN/DHCP/static WAN rules and chooses healthy WAN with deterministic recovery',()=>{
 const declarations=ROUTER_RUNTIME.slice(ROUTER_RUNTIME.indexOf('typedef struct {uint8_t'),ROUTER_RUNTIME.indexOf('static clex_rt_config_t'));
 const validation=ROUTER_RUNTIME.slice(ROUTER_RUNTIME.indexOf('static uint32_t clex_rt_ip('),ROUTER_RUNTIME.indexOf('static esp_err_t clex_rt_save('));
 const policy=ROUTER_RUNTIME.slice(ROUTER_RUNTIME.indexOf('static int clex_rt_choose_wan('),ROUTER_RUNTIME.indexOf('static void clex_rt_update('));
 let source=String.raw`
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
#include <assert.h>
#define IPPROTO_TCP 6
#define IPPROTO_UDP 17
typedef struct {uint32_t addr;} esp_ip4_addr_t;
typedef struct {esp_ip4_addr_t ip,netmask,gw;} esp_netif_ip_info_t;
static uint32_t ntohl(uint32_t x){return (x<<24)|((x&0xff00)<<8)|((x>>8)&0xff00)|(x>>24);}
static int esp_netif_str_to_ip4(const char*s,esp_ip4_addr_t*out){unsigned a,b,c,d;char tail;if(sscanf(s,"%u.%u.%u.%u%c",&a,&b,&c,&d,&tail)!=4||a>255||b>255||c>255||d>255)return 1;out->addr=ntohl((a<<24)|(b<<16)|(c<<8)|d);return 0;}
`+declarations+validation+policy+String.raw`
int main(void){
 clex_rt_config_t c={.version=1,.wan=1,.backup=2,.lan=1,.channel=6,.max_clients=4,.lease_minutes=120,.probe_interval=10000,.probe_timeout=3000,.dhcp=true,.ap_ssid="LAN",.ap_password="temporary-password",.admin_user="admin",.admin_password="temporary-admin",.sta_ssid="WAN",.sta_password="temporary-password",.lan_ip="192.168.50.1",.lan_mask="255.255.255.0",.dhcp_start="192.168.50.10",.dhcp_end="192.168.50.100",.probe_url="https://www.espressif.com/"};
 assert(clex_rt_validate(&c));
 strcpy(c.lan_mask,"0.0.0.0");assert(!clex_rt_validate(&c));strcpy(c.lan_mask,"255.255.255.0");
 strcpy(c.dhcp_start,c.lan_ip);assert(!clex_rt_validate(&c));strcpy(c.dhcp_start,"192.168.50.10");
 c.sta_static=true;strcpy(c.sta_ip,"192.168.50.2");strcpy(c.sta_mask,"255.255.255.0");strcpy(c.sta_gateway,"192.168.50.254");assert(!clex_rt_validate(&c));strcpy(c.sta_ip,"192.168.10.2");strcpy(c.sta_gateway,"192.168.10.1");assert(clex_rt_validate(&c));
 c.port_count=1;c.ports[0]=(clex_rt_port_t){.protocol=IPPROTO_TCP,.external=8080,.internal=80,.host=clex_rt_ip("192.168.50.25")};assert(clex_rt_validate(&c));c.ports[0].host=clex_rt_ip("10.0.0.5");assert(!clex_rt_validate(&c));c.port_count=0;
 memset(c.ap_ssid,'x',sizeof(c.ap_ssid));assert(!clex_rt_validate(&c));strcpy(c.ap_ssid,"LAN");
 bool up[2]={false,false},healthy[2]={false,false};assert(clex_rt_choose_wan(up,healthy)==-1);
 up[0]=true;assert(clex_rt_choose_wan(up,healthy)==0);up[1]=true;healthy[1]=true;assert(clex_rt_choose_wan(up,healthy)==1);
 healthy[0]=true;assert(clex_rt_choose_wan(up,healthy)==0);up[0]=false;assert(clex_rt_choose_wan(up,healthy)==1);up[1]=false;assert(clex_rt_choose_wan(up,healthy)==-1);
 esp_netif_ip_info_t a={.ip.addr=clex_rt_ip("192.168.0.2"),.netmask.addr=clex_rt_ip("255.255.0.0")},b={.ip.addr=clex_rt_ip("192.168.50.1"),.netmask.addr=clex_rt_ip("255.255.255.0")};assert(clex_rt_overlap(&a,&b));
 return 0;
}
`;
 for(const [key,value] of Object.entries({'@HAS_OTA@':'true','@HAS_ETH@':'true','@MAX_CLIENTS@':'10','@MAX_AUTH@':'2','@LAN_ROLE@':'1'}))source=source.replaceAll(key,value);
 runHostC(source,'clex-router-policy-');
});
test('actual DNS relay validates transaction IDs, supports UDP and framed TCP, and handles fragmented socket I/O',()=>{
 const helpers=ROUTER_DNS.slice(ROUTER_DNS.indexOf('static bool clex_rt_dns_io('),ROUTER_DNS.indexOf('static int clex_rt_dns_listener('));
 const exchange=ROUTER_DNS.slice(ROUTER_DNS.indexOf('static size_t clex_rt_dns_exchange('),ROUTER_DNS.indexOf('static size_t clex_rt_dns_name_end('));
 runHostC(String.raw`
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <assert.h>
#define ESP_OK 0
#define AF_INET 2
#define SOCK_STREAM 1
#define SOCK_DGRAM 2
#define IPPROTO_IP 0
#define SOL_SOCKET 1
#define SO_RCVTIMEO 2
#define SO_SNDTIMEO 3
#define SO_BINDTODEVICE 4
struct timeval {int tv_sec,tv_usec;};
struct ifreq {char ifr_name[16];};
struct sockaddr {int family;};
struct sockaddr_in {int sin_family;uint16_t sin_port;struct {uint32_t s_addr;} sin_addr;};
typedef int esp_netif_t;
static bool stream,fail_bind;static unsigned opened,closed,sent,read_offset;static uint8_t response[32];static size_t response_size;
static uint16_t htons(uint16_t n){return (n<<8)|(n>>8);}static uint16_t ntohs(uint16_t n){return htons(n);}
static int esp_netif_get_netif_impl_name(esp_netif_t*n,char*out){(void)n;strcpy(out,"st1");return 0;}
static int socket(int family,int type,int protocol){assert(family==AF_INET&&protocol==IPPROTO_IP);stream=type==SOCK_STREAM;opened++;sent=read_offset=0;return 7;}
static int setsockopt(int fd,int level,int option,const void*value,size_t size){assert(fd==7&&level==SOL_SOCKET);(void)value;(void)size;return option==SO_BINDTODEVICE&&fail_bind?-1:0;}
static int connect(int fd,const struct sockaddr*address,size_t size){assert(fd==7&&size==sizeof(struct sockaddr_in));const struct sockaddr_in*a=(const void*)address;assert(a->sin_port==htons(53)&&a->sin_addr.s_addr==123);return 0;}
static int send(int fd,const void*buffer,size_t size,int flags){assert(fd==7);(void)buffer;(void)flags;unsigned n=stream&&size>3?3:size;sent+=n;return n;}
static int recv(int fd,void*buffer,size_t size,int flags){assert(fd==7);(void)flags;if(read_offset>=response_size)return 0;size_t left=response_size-read_offset;if(size>left)size=left;if(stream&&size>3)size=3;memcpy(buffer,response+read_offset,size);read_offset+=size;return size;}
static int close(int fd){assert(fd==7);closed++;return 0;}
`+helpers+exchange+String.raw`
int main(void){
 esp_netif_t wan=1;uint8_t packet[4096]={0x12,0x34,1};response[0]=0x12;response[1]=0x34;response[2]=0x81;response_size=12;
 assert(clex_rt_dns_exchange(packet,12,false,123,&wan,2000)==12&&opened==closed&&sent==12);
 packet[2]=1;response[1]=0x35;assert(clex_rt_dns_exchange(packet,12,false,123,&wan,2000)==0&&opened==closed);
 response[1]=0x34;response[2]=0;packet[2]=1;assert(clex_rt_dns_exchange(packet,12,false,123,&wan,2000)==0);
 memset(response,0,sizeof(response));response[1]=12;response[2]=0x12;response[3]=0x34;response[4]=0x81;response_size=14;packet[2]=1;
 assert(clex_rt_dns_exchange(packet,12,true,123,&wan,2000)==12&&sent==14&&opened==closed);
 fail_bind=true;packet[2]=1;assert(!clex_rt_dns_exchange(packet,12,true,123,&wan,2000)&&opened==closed);
 unsigned before=opened;assert(!clex_rt_dns_exchange(packet,12,true,123,NULL,2000)&&opened==before);packet[2]=0x80;assert(!clex_rt_dns_exchange(packet,12,true,123,&wan,2000)&&opened==before);
 return 0;
}
`,'clex-router-dns-');
});
test('WAN probes resolve hostnames through each WAN DNS and reject malformed DNS answers',()=>{
 const resolver=ROUTER_DNS.slice(ROUTER_DNS.indexOf('static size_t clex_rt_dns_name_end('),ROUTER_DNS.indexOf('static void clex_rt_dns_task('));
 runHostC(String.raw`
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
#include <assert.h>
#define ESP_OK 0
#define ESP_NETIF_DNS_MAIN 0
#define ESP_IPADDR_TYPE_V4 0
typedef unsigned esp_netif_t;
typedef struct {uint32_t addr;} esp_ip4_addr_t;
typedef struct {struct {int type;union {esp_ip4_addr_t ip4;} u_addr;} ip;} esp_netif_dns_info_t;
static bool malformed;static unsigned calls;
static unsigned esp_random(void){return 0x1234;}
static int esp_netif_str_to_ip4(const char*text,esp_ip4_addr_t*out){if(!strcmp(text,"1.2.3.4")){out->addr=0x04030201;return 0;}return 1;}
static int esp_netif_get_dns_info(esp_netif_t*wan,int type,esp_netif_dns_info_t*out){assert(type==0);out->ip.type=0;out->ip.u_addr.ip4.addr=*wan*100;return 0;}
static size_t clex_rt_dns_exchange(uint8_t*p,size_t length,bool tcp,uint32_t server,esp_netif_t*wan,unsigned timeout){assert(!tcp&&server==*wan*100&&timeout<=2000&&p[0]==0x12&&p[1]==0x34&&p[5]==1);calls++;p[2]=0x81;p[3]=0x80;p[7]=1;const uint8_t rr[]={0xc0,12,0,1,0,1,0,0,0,60,0,4,10,0,0,0};memcpy(p+length,rr,sizeof(rr));p[length+15]=*wan;return length+(malformed?10:sizeof(rr));}
`+resolver+String.raw`
int main(void){esp_netif_t primary=1,backup=2;esp_ip4_addr_t out={0};assert(clex_rt_resolve(&primary,"www.example.com",&out,1500)&&((uint8_t*)&out.addr)[3]==1);assert(clex_rt_resolve(&backup,"www.example.com",&out,3000)&&((uint8_t*)&out.addr)[3]==2);assert(calls==2);malformed=true;assert(!clex_rt_resolve(&primary,"www.example.com",&out,1000));unsigned before=calls;assert(clex_rt_resolve(&primary,"1.2.3.4",&out,1000)&&out.addr==0x04030201&&calls==before);return 0;}
`,'clex-router-dns-wan-');
});
test('actual admin authorization accepts IPv4 and mapped IPv4 LAN clients while rejecting WAN, native IPv6 and invalid requests',()=>{
 const authorize=ROUTER_WEB.slice(ROUTER_WEB.indexOf('static bool clex_rt_auth_throttled('),ROUTER_WEB.indexOf('static esp_err_t clex_rt_json('));
 const encoded=Buffer.from('admin:temporary-admin').toString('base64');
 const source=String.raw`
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
#include <stddef.h>
#include <assert.h>
#define ESP_OK 0
#define HTTP_GET 0
#define HTTPD_403_FORBIDDEN 403
#define HTTPD_RESP_USE_STRLEN -1
// Match ESP-IDF lwIP socket layouts without platform-specific host socket APIs.
#define AF_INET 2
#define AF_INET6 10
#define AF_UNIX 1
#define CONFIG_LWIP_IPV6 @IPV6@
#define IN6_IS_ADDR_V4MAPPED(a) (!memcmp((a)->s6_addr,"\0\0\0\0\0\0\0\0\0\0\xff\xff",12))
#define portMAX_DELAY 0
typedef unsigned socklen_t;
struct sockaddr {uint8_t sa_len,sa_family;char data[14];};
struct sockaddr_storage {uint8_t s2_len,ss_family;uint16_t reserved;uint32_t data[6];};
struct sockaddr_in {uint8_t sin_len,sin_family;uint16_t sin_port;struct {uint32_t s_addr;} sin_addr;char zero[8];};
struct sockaddr_in6 {uint8_t sin6_len,sin6_family;uint16_t sin6_port;uint32_t flow;struct {uint8_t s6_addr[16];} sin6_addr;uint32_t scope;};
typedef struct {int method;const char*authorization,*origin,*host;} httpd_req_t;
static unsigned status=200;static int64_t clock_us=2000000;static uint32_t peer_address;
static bool challenge,no_store,retry_after;
static void reset_response(void){status=200;challenge=no_store=retry_after=false;}
static int peer_family=AF_INET;static bool native_ipv6,fail_peer,short_peer;
static unsigned clex_rt_mutex;
static struct {char lan_ip[16],lan_mask[16],admin_user[25],admin_password[64];} clex_rt_config={"192.168.50.1","255.255.255.0","admin","temporary-admin"};
typedef __typeof__(clex_rt_config) clex_rt_config_t;
static void xSemaphoreTake(unsigned m,unsigned wait){(void)m;(void)wait;}static void xSemaphoreGive(unsigned m){(void)m;}
static uint32_t clex_rt_ip(const char*s){unsigned a=0,b=0,c=0,d=0;sscanf(s,"%u.%u.%u.%u",&a,&b,&c,&d);return a|(b<<8)|(c<<16)|(d<<24);}
static int httpd_req_to_sockfd(httpd_req_t*r){(void)r;return 1;}
static int getpeername(int s,struct sockaddr*p,socklen_t*n){(void)s;if(fail_peer)return -1;memset(p,0,*n);p->sa_family=peer_family;
 if(peer_family==AF_INET){struct sockaddr_in*v=(void*)p;v->sin_addr.s_addr=peer_address;*n=sizeof(*v);}
 else if(peer_family==AF_INET6){struct sockaddr_in6*v=(void*)p;if(native_ipv6){v->sin6_addr.s6_addr[0]=0x20;v->sin6_addr.s6_addr[1]=0x01;}else{v->sin6_addr.s6_addr[10]=v->sin6_addr.s6_addr[11]=0xff;memcpy(&v->sin6_addr.s6_addr[12],&peer_address,sizeof(peer_address));}*n=sizeof(*v);}
 if(short_peer){*n=1;}
 return 0;
}
static int httpd_resp_send_err(httpd_req_t*r,int error,const char*text){(void)r;(void)text;status=error;return 0;}
static const char*header(httpd_req_t*r,const char*name){return !strcmp(name,"Authorization")?r->authorization:!strcmp(name,"Origin")?r->origin:!strcmp(name,"Host")?r->host:NULL;}
static int httpd_req_get_hdr_value_str(httpd_req_t*r,const char*name,char*out,size_t size){const char*v=header(r,name);if(!v||strlen(v)>=size)return 1;strcpy(out,v);return 0;}
static size_t httpd_req_get_hdr_value_len(httpd_req_t*r,const char*n){const char*v=header(r,n);return v?strlen(v):0;}
static int httpd_resp_set_status(httpd_req_t*r,const char*s){(void)r;status=(unsigned)atoi(s);return 0;}
static int httpd_resp_set_hdr(httpd_req_t*r,const char*n,const char*v){(void)r;
 if(!strcmp(n,"WWW-Authenticate")){assert(strstr(v,"Basic realm="));challenge=true;}
 if(!strcmp(n,"Cache-Control")){assert(!strcmp(v,"no-store"));no_store=true;}
 if(!strcmp(n,"Retry-After")){assert(!strcmp(v,"1"));retry_after=true;}
 return 0;
}
static int httpd_resp_send(httpd_req_t*r,const char*b,int n){(void)r;(void)b;(void)n;return 0;}
static int64_t esp_timer_get_time(void){return clock_us;}
static int mbedtls_base64_encode(unsigned char*out,size_t size,size_t*written,const unsigned char*source,size_t len){assert(len==strlen("admin:temporary-admin")&&!memcmp(source,"admin:temporary-admin",len));const char*encoded="@ENCODED@";assert(size>strlen(encoded));strcpy((char*)out,encoded);*written=strlen(encoded);return 0;}
` .replace('@ENCODED@',encoded).replace('#include <stddef.h>','#include <stddef.h>\n#include <stdlib.h>')+authorize+String.raw`
int main(void){
 httpd_req_t r={.authorization="Basic @ENCODED@",.host="192.168.50.1"};peer_address=clex_rt_ip("8.8.8.8");assert(!clex_rt_authorize(&r)&&status==403);
 peer_address=clex_rt_ip("192.168.50.25");r.authorization=NULL;
 for(unsigned i=0;i<5;i++){reset_response();assert(!clex_rt_authorize(&r)&&status==401&&challenge&&no_store&&!retry_after);}
 r.authorization="Basic @ENCODED@";reset_response();assert(clex_rt_authorize(&r)&&status==200&&no_store&&!challenge&&!retry_after);
 r.method=1;r.origin="http://evil.example";assert(!clex_rt_authorize(&r)&&status==403);
 r.origin="http://192.168.50.1";status=200;assert(clex_rt_authorize(&r)&&status==200);
 clock_us+=2000000;r.method=HTTP_GET;r.origin=NULL;r.authorization="Basic wrong";
 reset_response();assert(!clex_rt_authorize(&r)&&status==401&&challenge&&no_store&&!retry_after);
 reset_response();assert(!clex_rt_authorize(&r)&&status==429&&retry_after&&no_store&&!challenge);
 r.authorization=NULL;reset_response();assert(!clex_rt_authorize(&r)&&status==401&&challenge&&no_store&&!retry_after);
 // Another client has an independent retry interval, including a malformed long header.
 peer_address=clex_rt_ip("192.168.50.26");char oversized[250];memset(oversized,'x',sizeof(oversized)-1);oversized[sizeof(oversized)-1]=0;r.authorization=oversized;
 reset_response();assert(!clex_rt_authorize(&r)&&status==401&&challenge);
 reset_response();assert(!clex_rt_authorize(&r)&&status==429&&retry_after);
 peer_address=clex_rt_ip("192.168.50.25");r.authorization="Basic wrong";
 reset_response();assert(!clex_rt_authorize(&r)&&status==429&&retry_after);
 // Correct credentials recover immediately and reset only that client's failed attempt.
 r.authorization="Basic @ENCODED@";reset_response();assert(clex_rt_authorize(&r)&&status==200);
 r.authorization="Basic wrong";reset_response();assert(!clex_rt_authorize(&r)&&status==401&&challenge);
 peer_address=clex_rt_ip("192.168.50.26");r.authorization=oversized;reset_response();assert(!clex_rt_authorize(&r)&&status==429&&retry_after);
 clock_us+=1000000;reset_response();assert(!clex_rt_authorize(&r)&&status==401&&challenge&&!retry_after);
 peer_family=AF_INET6;peer_address=clex_rt_ip("192.168.50.25");r.method=HTTP_GET;r.authorization="Basic @ENCODED@";status=200;
#if CONFIG_LWIP_IPV6
 assert(clex_rt_authorize(&r)&&status==200);
 clock_us+=2000000;r.authorization=NULL;assert(!clex_rt_authorize(&r)&&status==401);r.authorization="Basic @ENCODED@";
#else
 assert(!clex_rt_authorize(&r)&&status==403);
#endif
 peer_address=clex_rt_ip("8.8.8.8");assert(!clex_rt_authorize(&r)&&status==403);
 peer_address=clex_rt_ip("192.168.50.25");native_ipv6=true;assert(!clex_rt_authorize(&r)&&status==403);native_ipv6=false;
 short_peer=true;assert(!clex_rt_authorize(&r)&&status==403);short_peer=false;
 peer_family=AF_INET;short_peer=true;assert(!clex_rt_authorize(&r)&&status==403);short_peer=false;
 fail_peer=true;assert(!clex_rt_authorize(&r)&&status==403);fail_peer=false;
 peer_family=AF_UNIX;assert(!clex_rt_authorize(&r)&&status==403);
 return 0;
}
`.replaceAll('@ENCODED@',encoded);
 for(const ipv6 of [0,1])runHostC(source.replace('@IPV6@',String(ipv6)),'clex-router-auth-');
});
