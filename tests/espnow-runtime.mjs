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
const statistics=process.argv.includes('--statistics'),health=process.argv.includes('--health')||statistics,plaintext=process.argv.includes('--plaintext');
const root=resolve((statistics?'.artifacts/espnow-statistics-runtime':health?'.artifacts/espnow-health-runtime':'.artifacts/espnow-runtime')+(plaintext?'-plaintext':''));mkdirSync(root,{recursive:true});
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
static const bool expect_encrypted=@TEST_PROTECTED@;
static int current,protocol[2],protocol_calls[2],rate[2][2],fail_rate_once;
static bool wifi_owned[2],drop_all;static unsigned drop_ack;
static unsigned health_changed[2][2],health_up[2][2],health_down[2][2];
static int8_t received_rssi=-63;
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
static int esp_now_add_peer(const esp_now_peer_info_t*p){assert(p->encrypt==expect_encrypted&&p->channel==1&&(!p->encrypt||p->lmk[0]==1));return 0;}
static int esp_now_register_recv_cb(recv_cb_t cb){receive_cb[current]=cb;return 0;}static int esp_now_register_send_cb(send_cb_t cb){send_cb[current]=cb;return 0;}
static int esp_now_set_peer_rate_config(const uint8_t*mac,esp_now_rate_config_t*c){int i=mac[5]==119?1:0;if(fail_rate_once&&current==0&&i==1&&c->phymode==WIFI_PHY_MODE_LR){fail_rate_once=0;return 1;}rate[current][i]=c->phymode;return 0;}
typedef struct {int sender,receiver,rate,len;uint8_t bytes[250];} wire_t;
static wire_t wire[2048],last_command;static unsigned wire_count;
static int esp_now_send(const uint8_t*mac,const uint8_t*data,size_t len){assert(len<=250);assert(wire_count<2048);wire_t*w=&wire[wire_count++];w->sender=current;w->receiver=!memcmp(mac,local_mac[1-current],6)?1-current:2;w->rate=rate[current][mac[5]==119?1:0];w->len=len;memcpy(w->bytes,data,len);if(data[5]==4)last_command=*w;if(send_cb[current])send_cb[current](mac,0);return 0;}
`;
let drivers='';
for(const[label,other]of[['a',1],['b',0]]){
 const {project}=espNowProject();const c=project.components[0],peers=JSON.parse(c.parameters.peers);peers[0].mac=other===1?'02:11:22:33:44:66':'02:11:22:33:44:55';peers.push({...peers[0],id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Extra peer',mac:'02:11:22:33:44:77',lmk:testKey});if(plaintext){c.parameters.encryption=false;for(const peer of peers)peer.encrypted=false;}c.parameters.peers=JSON.stringify(peers);c.parameters.timeoutMs=100;
 const monitors=health?peers.map((peer,i)=>({id:'health-'+i,moduleId:'clex.logic.espnow-control',parameters:{action:'peer',peerId:peer.id,probeIntervalMs:1000,offlineTimeoutMs:5000}})):[];
 const driver=espNowFirmware(project,monitors,new Map(monitors.map((node,i)=>[node.id,i])),cString,false);
 const callbacks=monitors.map((_,i)=>`static void node_${i}_emit_peerChanged(void){health_changed[current][${i}]++;}\nstatic void node_${i}_emit_connected(void){health_up[current][${i}]++;}\nstatic void node_${i}_emit_disconnected(void){health_down[current][${i}]++;}\n`).join('');
 const runtime=driver.source+(health?callbacks+[...driver.extraFunctions.values()].join('\n')+driver.notify:'');
 drivers+=runtime.replace(/\bclex_en_/g,label+'_clex_en_').replace(/\ben_/g,label+'_en_').replace(/\bEN_/g,label+'_EN_').replace(/\bespnow_/g,label+'_espnow_').replace(/\bnode_/g,label+'_node_')+'\n';
}
const checks=String.raw`
static unsigned commands[2],messages[2],confirmed[2],failed[2];static bool match_mode;
static void hook(unsigned kind,unsigned node,int id){(void)node;if(kind==3){commands[id]++;const char*cmd=id?b_clex_en_command.command:a_clex_en_command.command;bool ok=strcmp(cmd,"REJECT")!=0;if(!strcmp(cmd,"SET_LR"))ok=id?b_clex_en_set_mode(1):a_clex_en_set_mode(1);else if(!strcmp(cmd,"SET_NORMAL"))ok=id?b_clex_en_set_mode(0):a_clex_en_set_mode(0);if(id)b_clex_en_respond(ok);else a_clex_en_respond(ok);}if(kind==2)messages[id]++;if(kind==4){confirmed[id]++;if(match_mode&&!id){if(!strcmp(a_en_tx.command,"SET_LR"))a_clex_en_set_mode(1);if(!strcmp(a_en_tx.command,"SET_NORMAL"))a_clex_en_set_mode(0);}}if(kind==5)failed[id]++;}
static void a_clex_en_notify(unsigned kind,unsigned node){hook(kind,node,0);}static void b_clex_en_notify(unsigned kind,unsigned node){hook(kind,node,1);}
static void tick(int id){current=id;if(id)b_clex_en_poll();else a_clex_en_poll();}
static void deliver(wire_t w){if(drop_all||w.receiver>1)return;if(w.bytes[5]==5&&drop_ack){drop_ack--;return;}if(w.rate==WIFI_PHY_MODE_LR&&!(protocol[w.receiver]&WIFI_PROTOCOL_LR))return;wifi_pkt_rx_ctrl_t control={.rssi=received_rssi};esp_now_recv_info_t info={.src_addr=local_mac[w.sender],.des_addr=local_mac[w.receiver],.rx_ctrl=&control};receive_cb[w.receiver](&info,w.bytes,w.len);tick(w.receiver);}
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
 unsigned before_reject=failed[0];send_command("REJECT");pump();assert(failed[0]==before_reject+1&&!a_en_tx.active);
 unsigned before_messages=messages[1],before_confirmed=confirmed[0];current=0;assert(a_clex_en_send(0,4,false,"","Queued one"));assert(a_clex_en_send(0,4,false,"","Queued two"));pump();assert(messages[1]==before_messages+2&&confirmed[0]==before_confirmed+2);
 // No application ACK: bounded retries, one failed exchange and explicit loss accounting.
 unsigned failed_before=failed[0];drop_all=true;send_command("CUSTOM");pump();for(int i=0;i<4;i++){now_us+=100001;tick(0);pump();}assert(failed[0]==failed_before+1&&a_clex_en_status.lost==1&&!a_en_tx.active);
 puts("PASS: real HMAC, UTF-8, command ACK, deduplication, lost ACK recovery, Normal/LR receive compatibility, replay/restart protection, plaintext rejection, rate rollback, bounded retries and timeout accounting.");return 0;
}
`;
const transport=checks.slice(checks.indexOf('static void tick('),checks.indexOf('static void send_command('));
const healthChecks=String.raw`
static void advance(unsigned ms){for(unsigned i=0;i<ms;i+=50){now_us+=50000;tick(0);tick(1);pump();}}
int main(void){
 current=0;a_clex_en_initialize();current=1;b_clex_en_initialize();
 assert(a_clex_en_peer_read(0,5000).peerState==0);assert(!a_clex_en_peer_read(0,5000).rssiValid);
 tick(0);tick(1);pump();tick(0);tick(1);
 assert(a_espnow_value_0.online&&b_espnow_value_0.online);
 assert(a_espnow_value_0.rssiValid&&a_espnow_value_0.rssi==-63&&!strcmp(a_espnow_value_0.rssiText,"-63"));
 assert(health_up[0][0]==1&&health_up[1][0]==1);
 assert(a_clex_en_status.sent==0&&a_clex_en_status.received==0&&a_clex_en_status.lost==0);
 // Probes never replace the business message or command handshake/session.
 current=0;assert(a_clex_en_send(0,9,false,"","Payload"));pump();
 assert(b_clex_en_status.received==1&&!strcmp(b_clex_en_message.text,"Payload"));
 assert(a_clex_en_status.sent==1&&!a_en_tx.active);
 // The additional known peer is absent. Traffic from peer 0 must not revive it.
 for(int i=0;i<6;i++){now_us+=1000000;tick(0);tick(1);pump();}
 tick(0);assert(a_espnow_value_0.online&&a_espnow_value_1.peerState==2&&!a_espnow_value_1.online);
 assert(health_down[0][1]==1&&a_clex_en_status.lost==0);
 unsigned up_before=health_up[0][0];unsigned down_before=health_down[0][0];
 uint32_t received_before=b_clex_en_status.received;int mode=a_clex_en_status.mode;
 // Power loss: no successful responses. Invalidate the live RSSI and preserve history/mode/counts.
 drop_all=true;for(int i=0;i<6;i++){now_us+=1000000;tick(0);tick(1);pump();}
 assert(a_espnow_value_0.peerState==2&&!a_espnow_value_0.online&&!a_espnow_value_0.rssiValid);
 assert(a_espnow_value_0.rssi==0&&!strcmp(a_espnow_value_0.rssiText,"--"));
 assert(a_espnow_value_0.lastSeenSeconds>=5&&health_down[0][0]==down_before+1);
 assert(a_clex_en_status.ready&&a_clex_en_status.mode==mode&&a_clex_en_status.sent==1&&b_clex_en_status.received==received_before);
 // Invalid HMAC, an unrelated nonce, late responses and replay cannot revive the device.
 drop_all=false;wire_t ping={0};bool found=false;
 for(unsigned attempt=0;attempt<4&&!found;attempt++){now_us+=1000000;tick(0);while(wire_count){wire_t candidate=pop();if(candidate.receiver==1&&candidate.bytes[5]==6){ping=candidate;found=true;}}}
 assert(found);
 wire_count=0;deliver(ping);wire_t pong=pop();assert(pong.bytes[5]==7);wire_t replay=pong;
 if(expect_encrypted){wire_t bad=pong;bad.bytes[bad.len-1]^=1;deliver(bad);assert(!a_espnow_value_0.online);}
 uint64_t nonce=a_en_health[0].nonce;a_en_health[0].nonce++;deliver(pong);assert(!a_espnow_value_0.online);a_en_health[0].nonce=nonce;
 received_rssi=-127;deliver(pong);tick(0);assert(a_espnow_value_0.online&&!a_espnow_value_0.rssiValid&&a_espnow_value_0.rssi==0);
 assert(health_up[0][0]==up_before+1);int64_t reply=a_en_health[0].reply_at;
 now_us+=1000;deliver(replay);assert(a_en_health[0].reply_at==reply);
 // New samples restore RSSI. Missing API measurement must not reuse the old signal.
 received_rssi=-71;advance(2500);tick(0);
 assert(a_espnow_value_0.online&&a_espnow_value_0.rssiValid&&a_espnow_value_0.rssi==-71);
 // Local radio failure is a separate state, independent from Normal/LR.
 a_clex_en_status.ready=false;tick(0);assert(a_espnow_value_0.peerState==3&&!a_espnow_value_0.online&&a_espnow_value_0.rssi==0);
 a_clex_en_status.ready=true;
 // Reboot of the remote board starts fresh probe state and recovers without a button press.
 wifi_owned[1]=false;current=1;b_clex_en_initialize();advance(2500);tick(0);
 assert(a_espnow_value_0.online&&b_espnow_value_0.online);
 // Invalid peer and boot with no previous answer are explicitly unavailable/unknown.
 assert(a_clex_en_peer_read(99,5000).peerState==3);
 puts("PASS: per-peer waiting/online/offline, missing peer isolation, generated display events, timeout invalidation, unknown RSSI, app counts/mode preservation, HMAC/nonce/replay rejection, automatic recovery and remote restart.");return 0;
}
`;
const statisticsChecks=String.raw`
static void statistics_probe(bool drop_request,bool drop_report){
 now_us+=1000000;tick(0);assert(wire_count==1);wire_t ping=pop();assert(ping.bytes[5]==6&&ping.receiver==1);
 if(drop_request)return;
 deliver(ping);assert(wire_count==1);wire_t pong=pop();assert(pong.bytes[5]==7);if(!drop_report)deliver(pong);
}
static void silence_background(void){a_en_health[1].next_probe=INT64_MAX;b_en_health[0].next_probe=INT64_MAX;b_en_health[1].next_probe=INT64_MAX;}
int main(void){
 current=0;a_clex_en_initialize();current=1;b_clex_en_initialize();silence_background();
 // Establish the receiver boot; baseline probes are outside the measured data set.
 statistics_probe(false,false);assert(a_en_stats_tx[0].receiver_boot==b_en_boot&&a_en_stats_tx[0].sent==0);
 for(unsigned i=1;i<=100;i++)statistics_probe(i==20||i==40||i==60||i==80||i==99,i%7==0);
 assert(a_espnow_value_0.stats.valid&&a_espnow_value_0.stats.sent==100&&a_espnow_value_0.stats.received==95&&a_espnow_value_0.stats.lost==5&&a_espnow_value_0.stats.lossPercent==5);
 assert(!strcmp(a_espnow_value_0.stats.text,"Получено 95 из 100\nПотери 5 (5,0%)"));
 assert(a_espnow_value_1.stats.sent==0&&!a_espnow_value_1.stats.valid);
 assert(a_clex_en_status.sent==0&&b_clex_en_status.received==0&&a_clex_en_status.lost==0);
 // Lost reverse reports are reconciled by a later cumulative report.
 for(unsigned i=0;i<10;i++)statistics_probe(false,true);
 tick(0);assert(a_espnow_value_0.stats.pending==10&&a_espnow_value_0.stats.lost==5&&!a_espnow_value_0.stats.valid);
 statistics_probe(false,false);assert(a_espnow_value_0.stats.sent==111&&a_espnow_value_0.stats.received==106&&a_espnow_value_0.stats.lost==5);
 // Local mode changes preserve the sample until an explicit reset.
 current=0;assert(a_clex_en_set_mode(1));statistics_probe(false,false);assert(a_espnow_value_0.stats.lost==5&&b_clex_en_status.mode==0);
 // Outage: retain the last known result and show unknown outstanding delivery.
 for(unsigned i=0;i<6;i++)statistics_probe(true,false);
 tick(0);assert(!a_espnow_value_0.stats.valid&&a_espnow_value_0.stats.pending==6&&a_espnow_value_0.stats.lost==5&&!strcmp(a_espnow_value_0.stats.text,"Нет свежего отчета"));
 statistics_probe(false,false);assert(a_espnow_value_0.stats.lost==11&&a_espnow_value_0.stats.pending==0&&a_espnow_value_0.stats.valid);
 // A receiver restart discards the old ledger. It must not turn all old data into losses.
 wifi_owned[1]=false;current=1;b_clex_en_initialize();silence_background();statistics_probe(false,false);
 assert(a_en_stats_tx[0].sent==0&&a_espnow_value_0.stats.sent==0&&!a_espnow_value_0.stats.valid);
 statistics_probe(false,false);statistics_probe(false,false);assert(a_espnow_value_0.stats.sent==1&&a_espnow_value_0.stats.received==1&&a_espnow_value_0.stats.lost==0);
 // Generated graph reset clears only this peer's measurement and invalidates a stale pending reply.
 uint64_t session=a_en_stats_tx[0].session;current=0;a_node_0_resetStatistics();assert(a_en_stats_tx[0].session!=session&&a_espnow_value_0.stats.sent==0);
 statistics_probe(false,false);statistics_probe(false,false);assert(a_espnow_value_0.stats.sent==1&&a_espnow_value_0.stats.received==1);
 // Tampering with a protected reverse report cannot replace the known measurement.
 now_us+=1000000;tick(0);wire_t ping=pop();deliver(ping);wire_t pong=pop();
 if(expect_encrypted){wire_t bad=pong;bad.bytes[bad.len-1]^=1;deliver(bad);assert(a_en_stats_tx[0].measured==1);}
 deliver(pong);assert(a_en_stats_tx[0].measured==2&&a_en_stats_tx[0].received==2);
 int64_t last=a_en_stats_tx[0].report_at;now_us+=1000;deliver(pong);assert(a_en_stats_tx[0].report_at==last);
 puts("PASS: actual generated two-board C driver, 100/95/5 loss measurement, reverse report loss recovery, per-peer isolation, stale/outstanding delivery, Normal/LR, remote reboot, generated reset, HMAC and nonce replay protection.");return 0;
}
`;
writeFileSync(join(root,'test.c'),support.replace('@TEST_PROTECTED@',plaintext?'false':'true')+drivers+(health?transport+(statistics?statisticsChecks:healthChecks):checks));
const libraries=['md.c','sha256.c','platform_util.c'];
const result=spawnSync('cc',['-std=c11','-O1','-I',root,'-I',join(mbed,'include'),'-I',join(mbed,'library'),'-DMBEDTLS_CONFIG_FILE="test-config.h"',join(root,'test.c'),...libraries.map(f=>join(mbed,'library',f)),'-o',join(root,'test')],{encoding:'utf8'});
writeFileSync(join(root,'compile.log'),result.stdout+result.stderr);assert.equal(result.status,0,readFileSync(join(root,'compile.log'),'utf8'));
const run=spawnSync(join(root,'test'),[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);process.stdout.write(run.stdout);
