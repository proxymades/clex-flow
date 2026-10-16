import process from 'node:process';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import{spawnSync}from'node:child_process';
import{espNowFirmware}from'../src/firmware/drivers/espnow.js';
import{espNowProject,testKey}from'./espnow-fixture.js';
import{cString}from'../src/firmware/generator.js';
const sdk=process.env.CLEX_TEST_IDF_ROOT||process.env.IDF_PATH;
assert.ok(sdk,'Set CLEX_TEST_IDF_ROOT to the installed ESP-IDF 5.4.4 sources. This test downloads nothing.');
const mbed=join(sdk,'components/mbedtls/mbedtls');assert.ok(existsSync(join(mbed,'library/md.c')));
const root=resolve('.artifacts/espnow-runtime');mkdirSync(root,{recursive:true});
writeFileSync(join(root,'test-config.h'),'#define MBEDTLS_MD_C\n#define MBEDTLS_SHA256_C\n');
const support=String.raw`
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include <stdatomic.h>
#include <mbedtls/md.h>
typedef int esp_err_t;typedef int wifi_mode_t;typedef int esp_now_send_status_t;
#define ESP_OK 0
#define ESP_ERR_INVALID_STATE 1
#define ESP_NOW_SEND_SUCCESS 0
#define WIFI_IF_STA 0
#define WIFI_MODE_STA 1
#define WIFI_STORAGE_RAM 0
#define WIFI_SECOND_CHAN_NONE 0
#define WIFI_PS_NONE 0
#define WIFI_PROTOCOL_11B 1
#define WIFI_PROTOCOL_11G 2
#define WIFI_PROTOCOL_11N 4
#define WIFI_PROTOCOL_LR 8
#define WIFI_PHY_MODE_LR 1
#define WIFI_PHY_MODE_11B 0
#define WIFI_PHY_RATE_LORA_250K 250
#define WIFI_PHY_RATE_1M_L 1000
#define pdTRUE 1
#define ESP_LOGI(...) ((void)0)
#define MACSTR "%02x:%02x:%02x:%02x:%02x:%02x"
#define MAC2STR(a) (a)[0],(a)[1],(a)[2],(a)[3],(a)[4],(a)[5]
typedef struct {int nvs_enable;} wifi_init_config_t;
#define WIFI_INIT_CONFIG_DEFAULT() ((wifi_init_config_t){1})
typedef struct {int phymode,rate;bool ersu,dcm;} esp_now_rate_config_t;
typedef struct {uint8_t peer_addr[6],lmk[16];int channel,ifidx;bool encrypt;} esp_now_peer_info_t;
typedef struct {int8_t rssi;} wifi_pkt_rx_ctrl_t;
typedef struct {uint8_t*src_addr,*des_addr;wifi_pkt_rx_ctrl_t*rx_ctrl;} esp_now_recv_info_t;
typedef void(*recv_cb_t)(const esp_now_recv_info_t*,const uint8_t*,int);
typedef void(*send_cb_t)(const uint8_t*,esp_now_send_status_t);
typedef struct {unsigned cap,size,count,head,tail;uint8_t*data;} mock_queue_t;
typedef mock_queue_t*QueueHandle_t;
static QueueHandle_t xQueueCreate(unsigned cap,unsigned size){QueueHandle_t q=calloc(1,sizeof(*q));q->cap=cap;q->size=size;q->data=calloc(cap,size);return q;}
static int xQueueSend(QueueHandle_t q,const void*p,unsigned wait){(void)wait;if(q->count==q->cap)return 0;memcpy(q->data+q->tail*q->size,p,q->size);q->tail=(q->tail+1)%q->cap;q->count++;return 1;}
static int xQueueReceive(QueueHandle_t q,void*p,unsigned wait){(void)wait;if(!q->count)return 0;memcpy(p,q->data+q->head*q->size,q->size);q->head=(q->head+1)%q->cap;q->count--;return 1;}
static int current,protocol[2],protocol_calls[2],rate[2][2],fail_rate_once;
static bool wifi_owned[2],drop_all;static unsigned drop_ack;
static int64_t now_us;static uint64_t random_seed=100;
static uint8_t local_mac[2][6]={{2,17,34,51,68,85},{2,17,34,51,68,102}};
static recv_cb_t receive_cb[2];static send_cb_t send_cb[2];
static void esp_fill_random(void*out,size_t len){uint64_t n=++random_seed;assert(len==8);memcpy(out,&n,8);}
static int64_t esp_timer_get_time(void){return now_us;}
static const char*esp_err_to_name(int err){return err?"TEST_ERROR":"ESP_OK";}
static int esp_wifi_get_mode(wifi_mode_t*mode){*mode=1;return wifi_owned[current]?0:1;}
static int esp_netif_init(void){return 0;}static int esp_event_loop_create_default(void){return 0;}static int nvs_flash_init(void){return 0;}
static int esp_wifi_init(wifi_init_config_t*c){assert(c->nvs_enable==0);wifi_owned[current]=true;return 0;}
static int esp_wifi_set_storage(int a){(void)a;return 0;}static int esp_wifi_set_mode(int a){(void)a;return 0;}
static int esp_wifi_set_protocol(int i,int mask){(void)i;protocol[current]=mask;protocol_calls[current]++;return 0;}
static int esp_wifi_start(void){return 0;}static int esp_wifi_set_channel(int channel,int second){assert(channel==1);(void)second;return 0;}static int esp_wifi_set_ps(int a){(void)a;return 0;}
static int esp_wifi_get_mac(int i,uint8_t*mac){(void)i;memcpy(mac,local_mac[current],6);return 0;}
static int esp_now_init(void){return 0;}static int esp_now_set_pmk(const uint8_t*p){assert(p[0]==1);return 0;}
static int esp_now_add_peer(const esp_now_peer_info_t*p){assert(p->encrypt&&p->channel==1&&p->lmk[0]==1);return 0;}
static int esp_now_register_recv_cb(recv_cb_t cb){receive_cb[current]=cb;return 0;}static int esp_now_register_send_cb(send_cb_t cb){send_cb[current]=cb;return 0;}
static int esp_now_set_peer_rate_config(const uint8_t*mac,esp_now_rate_config_t*c){int i=mac[5]==119?1:0;if(fail_rate_once&&current==0&&i==1&&c->phymode==WIFI_PHY_MODE_LR){fail_rate_once=0;return 1;}rate[current][i]=c->phymode;return 0;}
typedef struct {int sender,receiver,rate,len;uint8_t bytes[250];} wire_t;
static wire_t wire[2048],last_command;static unsigned wire_count;
static int esp_now_send(const uint8_t*mac,const uint8_t*data,size_t len){assert(len<=250);assert(wire_count<2048);wire_t*w=&wire[wire_count++];w->sender=current;w->receiver=!memcmp(mac,local_mac[1-current],6)?1-current:2;w->rate=rate[current][mac[5]==119?1:0];w->len=len;memcpy(w->bytes,data,len);if(data[5]==4)last_command=*w;if(send_cb[current])send_cb[current](mac,0);return 0;}
`;
let drivers='';
for(const[label,other]of[['a',1],['b',0]]){
 const {project}=espNowProject();const c=project.components[0],peers=JSON.parse(c.parameters.peers);peers[0].mac=other===1?'02:11:22:33:44:66':'02:11:22:33:44:55';peers.push({...peers[0],id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Extra peer',mac:'02:11:22:33:44:77',lmk:testKey});c.parameters.peers=JSON.stringify(peers);c.parameters.timeoutMs=100;
 const runtime=espNowFirmware(project,[],new Map(),cString,false).source;
 drivers+=runtime.replace(/\bclex_en_/g,label+'_clex_en_').replace(/\ben_/g,label+'_en_').replace(/\bEN_/g,label+'_EN_')+'\n';
}
const checks=String.raw`
static unsigned commands[2],messages[2],confirmed[2],failed[2];static bool match_mode;
static void hook(unsigned kind,unsigned node,int id){(void)node;if(kind==3){commands[id]++;const char*cmd=id?b_clex_en_command.command:a_clex_en_command.command;bool ok=true;if(!strcmp(cmd,"SET_LR"))ok=id?b_clex_en_set_mode(1):a_clex_en_set_mode(1);else if(!strcmp(cmd,"SET_NORMAL"))ok=id?b_clex_en_set_mode(0):a_clex_en_set_mode(0);if(id)b_clex_en_respond(ok);else a_clex_en_respond(ok);}if(kind==2)messages[id]++;if(kind==4){confirmed[id]++;if(match_mode&&!id){if(!strcmp(a_en_tx.command,"SET_LR"))a_clex_en_set_mode(1);if(!strcmp(a_en_tx.command,"SET_NORMAL"))a_clex_en_set_mode(0);}}if(kind==5)failed[id]++;}
static void a_clex_en_notify(unsigned kind,unsigned node){hook(kind,node,0);}static void b_clex_en_notify(unsigned kind,unsigned node){hook(kind,node,1);}
static void tick(int id){current=id;if(id)b_clex_en_poll();else a_clex_en_poll();}
static void deliver(wire_t w){if(drop_all||w.receiver>1)return;if(w.bytes[5]==5&&drop_ack){drop_ack--;return;}if(w.rate==WIFI_PHY_MODE_LR&&!(protocol[w.receiver]&WIFI_PROTOCOL_LR))return;wifi_pkt_rx_ctrl_t control={.rssi=-63};esp_now_recv_info_t info={.src_addr=local_mac[w.sender],.des_addr=local_mac[w.receiver],.rx_ctrl=&control};receive_cb[w.receiver](&info,w.bytes,w.len);tick(w.receiver);}
static wire_t pop(void){assert(wire_count);wire_t w=wire[0];memmove(wire,wire+1,sizeof(wire_t)*(--wire_count));return w;}
static void pump(void){unsigned loops=0;while(wire_count){assert(++loops<1000);deliver(pop());}}
static void send_command(const char*name){current=0;assert(a_clex_en_send(0,9,true,name,"payload"));}
int main(void){
 current=0;a_clex_en_initialize();current=1;b_clex_en_initialize();assert(a_clex_en_status.ready&&b_clex_en_status.ready);tick(0);tick(1);assert(protocol[0]==15&&protocol[1]==15);
 current=0;assert(a_clex_en_send(0,3,false,"","Привет, мир!"));pump();assert(messages[1]==1&&confirmed[0]==1);assert(!strcmp(b_clex_en_message.text,"Привет, мир!"));assert(b_clex_en_message.rssi==-63);
 // Authenticate data even when the source MAC is known; a modified HMAC is rejected.
 send_command("CUSTOM");deliver(pop());deliver(pop());assert(wire_count==1&&wire[0].bytes[5]==4);wire_t modified=wire[0];modified.bytes[modified.len-1]^=1;deliver(modified);assert(commands[1]==0);pump();assert(commands[1]==1&&confirmed[0]==2);wire_t replay=last_command;deliver(replay);pump();assert(commands[1]==1);
 // A lost execution ACK never executes the same command twice. Both PHYs remain receivable.
 match_mode=true;drop_ack=1;send_command("SET_LR");pump();assert(commands[1]==2&&b_clex_en_status.mode==1&&a_clex_en_status.mode==0);now_us+=100001;tick(0);pump();assert(commands[1]==2&&a_clex_en_status.mode==1&&confirmed[0]==3);
 send_command("SET_NORMAL");pump();assert(commands[1]==3&&a_clex_en_status.mode==0&&b_clex_en_status.mode==0);assert(protocol_calls[0]==1&&protocol_calls[1]==1);
 // Old data cannot reappear after another handshake or a receiver restart.
 deliver(replay);pump();assert(commands[1]==3);
 memset(b_en_peers,0,sizeof(b_en_peers));b_en_rx.active=false;wifi_owned[1]=false;current=1;b_clex_en_initialize();deliver(replay);pump();assert(commands[1]==3);send_command("CUSTOM");pump();assert(commands[1]==4);
 // Known MAC with plaintext packet cannot inject a protected command.
 wire_t forged=last_command;forged.bytes[7]=0;forged.len-=16;deliver(forged);pump();assert(commands[1]==4);
 // A partial rate change restores all already changed peers.
 current=0;fail_rate_once=1;assert(!a_clex_en_set_mode(1));assert(a_clex_en_status.mode==0&&rate[0][0]==0&&rate[0][1]==0);assert(a_clex_en_set_mode(1));assert(a_clex_en_set_mode(0));
 unsigned before_unknown=b_en_raw_queue->count;uint8_t unknown_mac[6]={2,1,2,3,4,5};esp_now_recv_info_t unknown={.src_addr=unknown_mac,.des_addr=local_mac[1]};receive_cb[1](&unknown,last_command.bytes,last_command.len);assert(b_en_raw_queue->count==before_unknown);
 unsigned before_wrong_key=commands[1];b_en_peers[0].auth_key[0]^=1;send_command("CUSTOM");pump();assert(commands[1]==before_wrong_key&&a_en_tx.active);b_en_peers[0].auth_key[0]^=1;now_us+=100001;tick(0);pump();assert(commands[1]==before_wrong_key+1&&!a_en_tx.active);
 unsigned before_restart=commands[1],before_restart_failed=failed[0];drop_ack=1;send_command("CUSTOM");pump();assert(commands[1]==before_restart+1);memset(b_en_peers,0,sizeof(b_en_peers));b_en_rx.active=false;wifi_owned[1]=false;current=1;b_clex_en_initialize();now_us+=100001;tick(0);pump();assert(commands[1]==before_restart+1&&failed[0]==before_restart_failed+1&&!a_en_tx.active);
 unsigned before_messages=messages[1],before_confirmed=confirmed[0];current=0;assert(a_clex_en_send(0,4,false,"","Queued one"));assert(a_clex_en_send(0,4,false,"","Queued two"));pump();assert(messages[1]==before_messages+2&&confirmed[0]==before_confirmed+2);
 // No application ACK: bounded retries, one failed exchange and explicit loss accounting.
 unsigned failed_before=failed[0];drop_all=true;send_command("CUSTOM");pump();for(int i=0;i<4;i++){now_us+=100001;tick(0);pump();}assert(failed[0]==failed_before+1&&a_clex_en_status.lost==1&&!a_en_tx.active);
 puts("PASS: real HMAC, UTF-8, command ACK, deduplication, lost ACK recovery, Normal/LR receive compatibility, replay/restart protection, plaintext rejection, rate rollback, bounded retries and timeout accounting.");return 0;
}
`;
writeFileSync(join(root,'test.c'),support+drivers+checks);
const libraries=['md.c','sha256.c','platform_util.c'];
const result=spawnSync('cc',['-std=c11','-O1','-I',root,'-I',join(mbed,'include'),'-I',join(mbed,'library'),'-DMBEDTLS_CONFIG_FILE="test-config.h"',join(root,'test.c'),...libraries.map(f=>join(mbed,'library',f)),'-o',join(root,'test')],{encoding:'utf8'});
writeFileSync(join(root,'compile.log'),result.stdout+result.stderr);assert.equal(result.status,0,readFileSync(join(root,'compile.log'),'utf8'));
const run=spawnSync(join(root,'test'),[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);process.stdout.write(run.stdout);
