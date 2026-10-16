// All graph callbacks run from flow_worker. Wi-Fi callbacks only copy bounded packets.
export const ESPNOW_RUNTIME=String.raw`
enum { EN_HELLO=1, EN_HELLO_ACK=2, EN_MESSAGE=3, EN_COMMAND=4, EN_ACK=5 };
enum { EN_STATUS=1, EN_RECEIVED=2, EN_COMMAND_RECEIVED=3, EN_CONFIRMED=4, EN_FAILED=5 };
typedef struct { bool ready; int mode; uint32_t sent,received,lost; char mac[18],error[128]; } clex_en_status_t;
typedef struct { char sender[18],text[161],command[33]; int rssi; } clex_en_received_t;
static clex_en_status_t clex_en_status;
static clex_en_received_t clex_en_message,clex_en_command;
static void clex_en_notify(unsigned kind,unsigned node);
typedef struct { uint8_t mac[6],lmk[16]; bool encrypted; } clex_en_config_t;
@CONFIG@
#define EN_PEER_COUNT @COUNT@
static unsigned en_count(void){return EN_PEER_COUNT;}
#define EN_TIMEOUT_US (@TIMEOUT@LL*1000LL)
#define EN_RETRIES @RETRIES@
#define EN_ALLOW_MODE @ALLOW_MODE@
static const char *clex_en_component=@COMPONENT@;
static void en_error(const char *message){ if(strcmp(clex_en_status.error,message)){snprintf(clex_en_status.error,sizeof(clex_en_status.error),"%s",message);} }
static QueueHandle_t en_raw_queue;
static atomic_bool en_initialized;
static atomic_uint en_queue_drops,en_mac_failures;
static uint8_t en_local_mac[6];
static uint64_t en_boot;
static uint32_t en_sequence;
static bool en_dirty;
typedef struct { uint64_t source,challenge; uint32_t hello_seq,last_seq; bool complete,ok; uint8_t auth_key[32]; } en_peer_t;
static en_peer_t en_peers[EN_PEER_COUNT?EN_PEER_COUNT:1];
typedef struct { uint16_t length; uint8_t peer; int8_t rssi; uint8_t bytes[250]; } en_raw_t;
typedef struct { bool active; uint8_t phase,kind,peer,retries; unsigned node; uint32_t seq; uint64_t challenge,receiver_boot; int64_t due; char command[33],text[161]; } en_tx_t;
static en_tx_t en_tx;
static en_tx_t en_waiting[8];
static unsigned en_wait_head,en_wait_count;
static struct { bool active; uint8_t peer; uint32_t seq; int64_t due; uint64_t source,challenge; } en_rx;
static uint64_t en_random(void){uint64_t value;do {esp_fill_random(&value,sizeof(value));}while(!value);return value;}
static void en_put32(uint8_t*p,uint32_t value){for(int i=0;i<4;i++)p[i]=(uint8_t)(value>>(i*8));}
static uint32_t en_get32(const uint8_t*p){uint32_t value=0;for(int i=0;i<4;i++)value|=(uint32_t)p[i]<<(i*8);return value;}
static void en_put64(uint8_t*p,uint64_t value){for(int i=0;i<8;i++)p[i]=(uint8_t)(value>>(i*8));}
static uint64_t en_get64(const uint8_t*p){uint64_t value=0;for(int i=0;i<8;i++)value|=(uint64_t)p[i]<<(i*8);return value;}
static bool en_utf8(const uint8_t*p,size_t n){
 for(size_t i=0;i<n;){uint8_t a=p[i++];if(a==0)return false;if(a<0x80)continue;unsigned more;uint32_t cp,min;
 if(a>=0xc2&&a<=0xdf){more=1;cp=a&31;min=0x80;}else if(a>=0xe0&&a<=0xef){more=2;cp=a&15;min=0x800;}else if(a>=0xf0&&a<=0xf4){more=3;cp=a&7;min=0x10000;}else return false;
 if(i+more>n){return false;}
 while(more--){uint8_t b=p[i++];if((b&0xc0)!=0x80)return false;cp=(cp<<6)|(b&63);}if(cp<min||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))return false;
 }return true;
}
static bool en_tag(unsigned peer,const uint8_t *bytes,size_t n,uint8_t out[32]){
 return mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),en_peers[peer].auth_key,32,bytes,n,out)==0;
}
static bool en_packet(unsigned peer,uint8_t kind,uint8_t result,uint64_t source,uint64_t dest,uint32_t seq,const char*command,const char*text){
 uint8_t bytes[250]={0};size_t a=strlen(command),b=strlen(text);if(peer>=en_count()||a>32||b>160)return false;
 memcpy(bytes,"CLNW",4);bytes[4]=1;bytes[5]=kind;bytes[6]=result;bytes[7]=clex_en_config[peer].encrypted?1:0;en_put64(bytes+8,source);en_put64(bytes+16,dest);en_put32(bytes+24,seq);bytes[28]=a;bytes[29]=b;
 memcpy(bytes+32,command,a);memcpy(bytes+32+a,text,b);size_t length=32+a+b;
 if(clex_en_config[peer].encrypted){uint8_t tag[32];if(!en_tag(peer,bytes,length,tag))return false;memcpy(bytes+length,tag,16);length+=16;}
 esp_err_t err=esp_now_send(clex_en_config[peer].mac,bytes,length);
 if(err!=ESP_OK){snprintf(clex_en_status.error,sizeof(clex_en_status.error),"ESP-NOW send: %s",esp_err_to_name(err));en_dirty=true;return false;}
 if(kind==EN_MESSAGE||kind==EN_COMMAND){clex_en_status.sent++;en_dirty=true;}return true;
}
static bool en_ack(unsigned peer,uint64_t challenge,uint64_t source,uint32_t seq,bool ok){return en_packet(peer,EN_ACK,ok?1:2,challenge,source,seq,"","");}
static void en_receive(const esp_now_recv_info_t*info,const uint8_t*bytes,int length){
 if(!info||!info->src_addr||!info->des_addr||!bytes||length<32||length>250||memcmp(info->des_addr,en_local_mac,6))return;
 for(unsigned peer=0;peer<en_count();peer++)if(!memcmp(info->src_addr,clex_en_config[peer].mac,6)){
  en_raw_t packet={.length=(uint16_t)length,.peer=(uint8_t)peer,.rssi=info->rx_ctrl?info->rx_ctrl->rssi:-127};memcpy(packet.bytes,bytes,length);if(xQueueSend(en_raw_queue,&packet,0)!=pdTRUE)atomic_fetch_add(&en_queue_drops,1);break;
 }
}
static void en_send_complete(const uint8_t*mac,esp_now_send_status_t status){(void)mac;if(status!=ESP_NOW_SEND_SUCCESS)atomic_fetch_add(&en_mac_failures,1);}
static esp_err_t en_rate(unsigned peer,int mode){esp_now_rate_config_t config={.phymode=mode?WIFI_PHY_MODE_LR:WIFI_PHY_MODE_11B,.rate=mode?WIFI_PHY_RATE_LORA_250K:WIFI_PHY_RATE_1M_L,.ersu=false,.dcm=false};return esp_now_set_peer_rate_config(clex_en_config[peer].mac,&config);}
static bool __attribute__((unused)) clex_en_set_mode(int mode){
 if(!clex_en_status.ready){en_error("Радио ESP-NOW не готово");en_dirty=true;return false;}
 if(!EN_ALLOW_MODE){en_error("Переключение режима запрещено в настройках");en_dirty=true;return false;}
 int before=clex_en_status.mode;unsigned applied=0;esp_err_t err=ESP_OK;
 for(;applied<en_count();applied++){err=en_rate(applied,mode);if(err!=ESP_OK)break;}
 if(err!=ESP_OK){bool rolled=true;for(unsigned i=0;i<en_count();i++)if(en_rate(i,before==1?1:0)!=ESP_OK)rolled=false;clex_en_status.mode=rolled?(before==1?1:0):2;snprintf(clex_en_status.error,sizeof(clex_en_status.error),"Режим: %s%s",esp_err_to_name(err),rolled?"":"; откат выполнен не полностью");en_dirty=true;return false;}
 if(before!=mode||clex_en_status.error[0]){en_dirty=true;}
 clex_en_status.mode=mode;clex_en_status.error[0]=0;return true;
}
static bool __attribute__((unused)) clex_en_respond(bool ok){
 if(!en_rx.active){en_error("Нет команды, ожидающей подтверждения");en_dirty=true;return false;}
 bool sent=en_ack(en_rx.peer,en_rx.challenge,en_rx.source,en_rx.seq,ok);
 // Cache the result even if ACK delivery failed: duplicates may resend it, never execute twice.
 en_peers[en_rx.peer].complete=true;en_peers[en_rx.peer].ok=ok;en_rx.active=false;en_dirty=true;return sent;
}
static void en_tx_end(bool ok,bool lost,const char*reason){unsigned node=en_tx.node;en_tx.active=false;if(lost)clex_en_status.lost++;if(!ok)en_error(reason);else clex_en_status.error[0]=0;en_dirty=true;clex_en_notify(ok?EN_CONFIRMED:EN_FAILED,node);}
static void en_hello(void){en_tx.phase=1;en_tx.due=esp_timer_get_time()+EN_TIMEOUT_US;en_packet(en_tx.peer,EN_HELLO,0,en_boot,0,en_tx.seq,"","");}
static bool __attribute__((unused)) clex_en_send(unsigned peer,unsigned node,bool command,const char*name,const char*text){
 if(!clex_en_status.ready){en_error("Радио ESP-NOW не готово");en_dirty=true;return false;}
 if(peer>=en_count()){en_error("Устройство не найдено");en_dirty=true;return false;}
 if(en_wait_count>=8){en_error("Переполнена очередь отправки ESP-NOW");en_dirty=true;return false;}
 if(command&&!clex_en_config[peer].encrypted){en_error("Команды разрешены только по защищенному соединению");en_dirty=true;return false;}
 if(!name||!text||strlen(name)>32||strlen(text)>160||!en_utf8((const uint8_t*)name,strlen(name))||!en_utf8((const uint8_t*)text,strlen(text))){en_error("Неверный UTF-8 или превышен размер текста");en_dirty=true;return false;}
 if(en_sequence==UINT32_MAX){en_error("Исчерпаны номера обменов; перезапустите устройство");en_dirty=true;return false;}
 en_tx_t request={.active=true,.peer=peer,.node=node,.kind=command?EN_COMMAND:EN_MESSAGE,.seq=++en_sequence,.retries=EN_RETRIES};snprintf(request.command,sizeof(request.command),"%s",name);snprintf(request.text,sizeof(request.text),"%s",text);
 if(en_tx.active||en_wait_count){en_waiting[(en_wait_head+en_wait_count)%8]=request;en_wait_count++;}else{en_tx=request;en_hello();}return true;
}
static void en_handle(const en_raw_t*raw){
 const uint8_t*p=raw->bytes;unsigned peer=raw->peer;size_t a=p[28],b=p[29],n=32+a+b;
 bool protected=clex_en_config[peer].encrypted;
 if(memcmp(p,"CLNW",4)||p[4]!=1||p[7]!=(protected?1:0)||p[30]||p[31]||a>32||b>160||raw->length!=n+(protected?16:0))return;
 if(protected){uint8_t tag[32],difference=0;if(!en_tag(peer,p,n,tag))return;for(int i=0;i<16;i++)difference|=tag[i]^p[n+i];if(difference)return;}
 uint8_t kind=p[5];uint64_t source=en_get64(p+8),dest=en_get64(p+16);uint32_t seq=en_get32(p+24);if(!source||!seq||kind<EN_HELLO||kind>EN_ACK)return;
 if((kind==EN_HELLO||kind==EN_ACK)&&(a||b))return;
 if(kind==EN_HELLO_ACK&&(a||b!=16))return;
 en_peer_t*state=&en_peers[peer];
 if(kind==EN_HELLO){
  if(dest||p[6])return;
  if(en_rx.active&&en_rx.peer==peer&&(en_rx.source!=source||en_rx.seq!=seq))return;
  if(source==state->source&&seq<state->last_seq)return;
  if(source!=state->source||seq!=state->hello_seq){if(source!=state->source){state->last_seq=0;state->complete=false;}state->source=source;state->hello_seq=seq;state->challenge=en_random();}
  char boot[17];snprintf(boot,sizeof(boot),"%016llx",(unsigned long long)en_boot);en_packet(peer,EN_HELLO_ACK,0,state->challenge,source,seq,"",boot);return;
 }
 if(kind==EN_HELLO_ACK){if(p[6]||dest!=en_boot||!en_tx.active||en_tx.phase!=1||en_tx.peer!=peer||en_tx.seq!=seq)return;char boot[17];memcpy(boot,p+32,16);boot[16]=0;for(unsigned i=0;i<16;i++)if(!((boot[i]>='0'&&boot[i]<='9')||(boot[i]>='a'&&boot[i]<='f')))return;uint64_t receiver_boot=strtoull(boot,NULL,16);if(!receiver_boot)return;
  if(en_tx.kind==EN_COMMAND&&en_tx.receiver_boot&&en_tx.receiver_boot!=receiver_boot){en_tx_end(false,false,"Плата перезапустилась; результат команды неизвестен");return;}
  en_tx.receiver_boot=receiver_boot;en_tx.phase=2;en_tx.challenge=source;en_tx.due=esp_timer_get_time()+EN_TIMEOUT_US;en_packet(peer,en_tx.kind,0,en_boot,source,seq,en_tx.command,en_tx.text);return;}
 if(kind==EN_ACK){if((p[6]!=1&&p[6]!=2)||!en_tx.active||en_tx.phase!=2||peer!=en_tx.peer||seq!=en_tx.seq||dest!=en_boot||source!=en_tx.challenge)return;en_tx_end(p[6]==1,false,"Получатель сообщил об ошибке выполнения");return;}
 if(p[6]||source!=state->source||dest!=state->challenge||seq!=state->hello_seq||!en_utf8(p+32,a)||!en_utf8(p+32+a,b)||(kind==EN_MESSAGE&&a)||(kind==EN_COMMAND&&(!a||!protected)))return;
 if(seq==state->last_seq){if(state->complete)en_ack(peer,state->challenge,source,seq,state->ok);return;}
 if(seq<state->last_seq)return;
 state->last_seq=seq;state->complete=false;
 if(kind==EN_COMMAND&&en_rx.active){state->complete=true;state->ok=false;en_ack(peer,state->challenge,source,seq,false);return;}
 clex_en_received_t*value=kind==EN_MESSAGE?&clex_en_message:&clex_en_command;
 snprintf(value->sender,sizeof(value->sender),MACSTR,MAC2STR(clex_en_config[peer].mac));memcpy(value->command,p+32,a);value->command[a]=0;memcpy(value->text,p+32+a,b);value->text[b]=0;value->rssi=raw->rssi;clex_en_status.received++;en_dirty=true;
 if(kind==EN_MESSAGE){state->complete=true;state->ok=true;en_ack(peer,state->challenge,source,seq,true);clex_en_notify(EN_RECEIVED,0);}
 else{en_rx.active=true;en_rx.peer=peer;en_rx.seq=seq;en_rx.source=source;en_rx.challenge=state->challenge;en_rx.due=esp_timer_get_time()+EN_TIMEOUT_US*2*(EN_RETRIES+1);clex_en_notify(EN_COMMAND_RECEIVED,0);}
}
static void __attribute__((unused)) clex_en_poll(void){
 if(!atomic_load(&en_initialized))return;
 if(en_raw_queue){en_raw_t raw;for(unsigned i=0;i<8&&xQueueReceive(en_raw_queue,&raw,0)==pdTRUE;i++)en_handle(&raw);}
 int64_t now=esp_timer_get_time();
 if(!EN_PEER_COUNT&&clex_en_status.mac[0]){static int64_t last_mac;if(now-last_mac>=5000000){last_mac=now;ESP_LOGI("CLEX_ESPNOW","component=%s mac=%s",clex_en_component,clex_en_status.mac);}}
 if(en_tx.active&&now>=en_tx.due){if(en_tx.retries){en_tx.retries--;en_hello();}else en_tx_end(false,true,"Не получено подтверждение приложения");}
 if(en_rx.active&&now>=en_rx.due){clex_en_respond(false);en_error("Логика не подтвердила обработку команды");en_dirty=true;}
 if(atomic_exchange(&en_queue_drops,0)){en_error("Переполнена очередь приема ESP-NOW");en_dirty=true;}
 atomic_exchange(&en_mac_failures,0); // MAC delivery is deliberately not application completion.
 if(!en_tx.active&&en_wait_count){en_tx=en_waiting[en_wait_head];en_wait_head=(en_wait_head+1)%8;en_wait_count--;en_hello();}
 if(en_dirty){en_dirty=false;clex_en_notify(EN_STATUS,0);}
}
static bool en_initial_rate(int mode){for(unsigned i=0;i<en_count();i++)if(en_rate(i,mode)!=ESP_OK)return false;return true;}
static void clex_en_initialize(void){
 esp_err_t err;wifi_mode_t owner;
 if(esp_wifi_get_mode(&owner)==ESP_OK){en_error("Радио уже используется другим Wi-Fi-драйвером");goto finish;}
 @NETIF@
 err=esp_event_loop_create_default();if(err!=ESP_OK&&err!=ESP_ERR_INVALID_STATE){en_error("Не удалось подготовить очередь Wi-Fi");goto finish;}
 err=nvs_flash_init();if(err!=ESP_OK){en_error("Не удалось открыть NVS для Wi-Fi; данные сохранены");goto finish;}
 wifi_init_config_t config=WIFI_INIT_CONFIG_DEFAULT();config.nvs_enable=0;
 #define EN_INIT(call) do{err=(call);if(err!=ESP_OK){snprintf(clex_en_status.error,sizeof(clex_en_status.error),"ESP-NOW init: %s",esp_err_to_name(err));goto finish;}}while(0)
 EN_INIT(esp_wifi_init(&config));EN_INIT(esp_wifi_set_storage(WIFI_STORAGE_RAM));EN_INIT(esp_wifi_set_mode(WIFI_MODE_STA));
 // Both receive protocols remain allowed. Only the per-peer transmit PHY changes.
 EN_INIT(esp_wifi_set_protocol(WIFI_IF_STA,WIFI_PROTOCOL_11B|WIFI_PROTOCOL_11G|WIFI_PROTOCOL_11N|WIFI_PROTOCOL_LR));EN_INIT(esp_wifi_start());EN_INIT(esp_wifi_set_channel(@CHANNEL@,WIFI_SECOND_CHAN_NONE));EN_INIT(esp_wifi_set_ps(WIFI_PS_NONE));
 EN_INIT(esp_wifi_get_mac(WIFI_IF_STA,en_local_mac));snprintf(clex_en_status.mac,sizeof(clex_en_status.mac),MACSTR,MAC2STR(en_local_mac));
 ESP_LOGI("CLEX_ESPNOW","component=%s mac=%s",clex_en_component,clex_en_status.mac);
 en_raw_queue=xQueueCreate(32,sizeof(en_raw_t));if(!en_raw_queue){en_error("Не удалось создать очередь приема ESP-NOW");goto finish;}
 en_boot=en_random();EN_INIT(esp_now_init());
 @PMK@
 for(unsigned i=0;i<en_count();i++){
  if(!memcmp(clex_en_config[i].mac,en_local_mac,6)){en_error("В списке устройств указан MAC самой платы");goto finish;}
  esp_now_peer_info_t peer={.channel=@CHANNEL@,.ifidx=WIFI_IF_STA,.encrypt=clex_en_config[i].encrypted};memcpy(peer.peer_addr,clex_en_config[i].mac,6);memcpy(peer.lmk,clex_en_config[i].lmk,16);EN_INIT(esp_now_add_peer(&peer));
  if(peer.encrypt&&mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),peer.lmk,16,(const uint8_t*)"CLEXFlowESPNowAuthv1",sizeof("CLEXFlowESPNowAuthv1")-1,en_peers[i].auth_key)){en_error("Не удалось подготовить аутентификацию ESP-NOW");goto finish;}
 }
 EN_INIT(esp_now_register_recv_cb(en_receive));EN_INIT(esp_now_register_send_cb(en_send_complete));
 clex_en_status.ready=true;clex_en_status.mode=@MODE@;
 if(!en_initial_rate(@MODE@)){clex_en_status.mode=2;en_error("Не удалось установить начальную скорость передачи");}
 finish:
 #undef EN_INIT
 en_dirty=true;atomic_store(&en_initialized,true);
}
`;
