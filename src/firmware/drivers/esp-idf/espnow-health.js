import {ESPNOW_STATISTICS} from './espnow-statistics.js';
// Health checks have their own nonces and never modify command/session state.
export const ESPNOW_HEALTH=String.raw`
${ESPNOW_STATISTICS}
typedef struct { bool seen,pending,rssi_valid,ping_seen; int rssi; uint32_t seq; uint64_t nonce; int64_t reply_at,rssi_at,probe_at,next_probe,ping_at; } en_health_t;
typedef struct { int peerState,rssi; bool online,rssiValid; int32_t lastSeenSeconds; char rssiText[16]; en_stats_snapshot_t stats; } clex_en_peer_snapshot_t;
static en_health_t en_health[EN_PEER_COUNT?EN_PEER_COUNT:1];
static const int64_t en_probe_intervals[EN_PEER_COUNT?EN_PEER_COUNT:1]=@HEALTH_INTERVALS@;
static int64_t en_health_started,en_next_probe;
static unsigned en_probe_cursor;
static void en_health_reply(unsigned peer,int rssi){
 en_health_t*h=&en_health[peer];h->seen=true;h->reply_at=esp_timer_get_time();h->rssi=rssi;h->rssi_valid=rssi!=-127;h->rssi_at=h->reply_at;
}
static clex_en_peer_snapshot_t __attribute__((unused)) clex_en_peer_read(unsigned peer,int timeout_ms){
 clex_en_peer_snapshot_t value={.lastSeenSeconds=-1};
 if(peer>=en_count()){value.peerState=3;snprintf(value.rssiText,sizeof(value.rssiText),"--");snprintf(value.stats.text,sizeof(value.stats.text),"--");return value;}
 const en_health_t*h=&en_health[peer];int64_t now=esp_timer_get_time(),age=now-h->reply_at,limit=(int64_t)timeout_ms*1000;
 value.peerState=!clex_en_status.ready?3:h->seen?(age<limit?1:2):(now-en_health_started<limit?0:2);
 value.online=value.peerState==1;value.rssiValid=value.online&&h->rssi_valid&&now-h->rssi_at<limit;
 value.rssi=value.rssiValid?h->rssi:0;
 if(h->seen){int64_t seconds=age/1000000;value.lastSeenSeconds=(int32_t)(seconds>INT32_MAX?INT32_MAX:seconds);}
 if(value.rssiValid){snprintf(value.rssiText,sizeof(value.rssiText),"%d",value.rssi);}else{snprintf(value.rssiText,sizeof(value.rssiText),"--");}
 value.stats=en_stats_read(peer,limit,value.online);
 return value;
}
static void __attribute__((unused)) clex_en_reset_statistics(unsigned peer){
 if(peer>=en_count())return;
 en_stats_reset(peer);en_health[peer].pending=false;en_health[peer].next_probe=esp_timer_get_time();en_next_probe=esp_timer_get_time();clex_en_notify(EN_PEER,peer);
}
static void en_health_handle(unsigned peer,uint8_t kind,uint64_t source,uint64_t dest,uint32_t seq,int rssi,const uint8_t*text,size_t size){
 en_health_t*h=&en_health[peer];int64_t now=esp_timer_get_time();
 if(kind==EN_PING){
  if(dest||!clex_en_status.ready)return;
  char report[34]="";en_stats_request(peer,text,size,report);
  if(h->ping_seen&&now-h->ping_at<200000)return;
  h->ping_seen=true;h->ping_at=now;en_packet(peer,EN_PONG,0,en_boot,source,seq,"",report);return;
 }
 int64_t expiry=en_probe_intervals[peer]>EN_TIMEOUT_US?en_probe_intervals[peer]:EN_TIMEOUT_US;
 if(!h->pending||dest!=h->nonce||seq!=h->seq||now-h->probe_at>=expiry)return;
 h->pending=false;en_health_reply(peer,rssi);en_stats_response(peer,source,text,size);
}
static void en_health_poll(void){
 int64_t now=esp_timer_get_time();
 if(clex_en_status.ready&&now>=en_next_probe){
  for(unsigned offset=0;offset<en_count();offset++){
   unsigned peer=(en_probe_cursor+offset)%en_count();en_health_t*h=&en_health[peer];int64_t interval=en_probe_intervals[peer];
   if(!interval||now<h->next_probe)continue;
   int64_t expiry=interval>EN_TIMEOUT_US?interval:EN_TIMEOUT_US;
   if(h->pending&&now-h->probe_at<expiry)continue;
   h->nonce=en_random();if(++h->seq==0){h->seq=1;}h->pending=true;h->probe_at=now;h->next_probe=now+interval;
   en_probe_cursor=(peer+1)%en_count();en_next_probe=now+10000;
   char measurement[25];en_stats_prepare(peer,measurement);bool accepted=en_packet(peer,EN_PING,0,h->nonce,0,h->seq,"",measurement);en_stats_sent(peer,accepted);if(!accepted)h->pending=false;
   break;
  }
 }
 for(unsigned peer=0;peer<en_count();peer++)clex_en_notify(EN_PEER,peer);
}
`;
