// One-way application packet delivery, reported by the receiver, independently of ACK loss.
export const ESPNOW_STATISTICS=String.raw`
#define EN_STATS_WINDOW 256
typedef struct { uint64_t session,receiver_boot; uint32_t sent,measured,received,send_errors; int64_t report_at; } en_stats_tx_t;
typedef struct { uint64_t session; uint32_t highest,received,bits[EN_STATS_WINDOW/32]; } en_stats_rx_t;
typedef struct { uint32_t sent,received,lost,pending,sendErrors; double lossPercent; bool valid; char text[160]; } en_stats_snapshot_t;
static en_stats_tx_t en_stats_tx[EN_PEER_COUNT?EN_PEER_COUNT:1];
static en_stats_rx_t en_stats_rx[EN_PEER_COUNT?EN_PEER_COUNT:1];
static void en_stats_reset(unsigned peer){memset(&en_stats_tx[peer],0,sizeof(en_stats_tx[peer]));en_stats_tx[peer].session=en_random();}
static bool en_stats_hex(const uint8_t*p,unsigned size,uint64_t*out){
 uint64_t value=0;for(unsigned i=0;i<size;i++){uint8_t c=p[i];unsigned digit;if(c>='0'&&c<='9')digit=c-'0';else if(c>='a'&&c<='f')digit=c-'a'+10;else return false;value=(value<<4)|digit;}*out=value;return true;
}
static void en_stats_prepare(unsigned peer,char out[25]){
 en_stats_tx_t*t=&en_stats_tx[peer];if(!t->session||t->sent==UINT32_MAX)en_stats_reset(peer);
 // Sequence zero establishes the receiver boot before any packets enter the measurement.
 snprintf(out,25,"%016llx%08lx",(unsigned long long)t->session,(unsigned long)(t->receiver_boot?t->sent+1:0));
}
static void en_stats_sent(unsigned peer,bool accepted){
 en_stats_tx_t*t=&en_stats_tx[peer];if(accepted){if(t->receiver_boot)t->sent++;}else if(t->send_errors<UINT32_MAX)t->send_errors++;
}
static bool en_stats_request(unsigned peer,const uint8_t*text,size_t size,char out[34]){
 uint64_t session,index;if(size!=24||!en_stats_hex(text,16,&session)||!session||!en_stats_hex(text+16,8,&index))return false;
 en_stats_rx_t*r=&en_stats_rx[peer];
 if(r->session!=session){if(index){snprintf(out,34,"%016llx%08lx000000001",(unsigned long long)session,(unsigned long)index);return true;}memset(r,0,sizeof(*r));r->session=session;}
 if(!index){if(r->highest)return false;}
 else{
  uint32_t seq=(uint32_t)index;
  if(seq>r->highest){uint32_t delta=seq-r->highest;if(delta>=EN_STATS_WINDOW)memset(r->bits,0,sizeof(r->bits));else for(uint32_t n=1;n<=delta;n++){uint32_t bit=(r->highest+n)%EN_STATS_WINDOW;r->bits[bit/32]&=~(1u<<(bit%32));}r->highest=seq;}
  if(r->highest-seq<EN_STATS_WINDOW){uint32_t bit=seq%EN_STATS_WINDOW,mask=1u<<(bit%32);if(!(r->bits[bit/32]&mask)){r->bits[bit/32]|=mask;r->received++;}}
  // A report describes a complete prefix; a delayed lower index cannot include future packets.
  if(seq!=r->highest)return false;
 }
 snprintf(out,34,"%016llx%08lx%08lx0",(unsigned long long)session,(unsigned long)index,(unsigned long)r->received);return true;
}
static void en_stats_response(unsigned peer,uint64_t receiver_boot,const uint8_t*text,size_t size){
 en_stats_tx_t*t=&en_stats_tx[peer];
 // A reboot loses the receiver ledger. Begin a fresh measurement instead of inventing losses.
 if(t->receiver_boot&&t->receiver_boot!=receiver_boot){en_stats_reset(peer);return;}
 uint64_t session,index,count;if(size!=33||!en_stats_hex(text,16,&session)||session!=t->session||!en_stats_hex(text+16,8,&index)||!en_stats_hex(text+24,8,&count)||index!=t->sent||count>index)return;
 // The peer can explicitly report an unavailable ledger, including after a delayed old baseline.
 if(text[32]=='1'){if(!count)en_stats_reset(peer);return;}if(text[32]!='0')return;
 if(!t->receiver_boot){if(index||count)return;t->receiver_boot=receiver_boot;return;}
 if(index<t->measured||count<t->received)return;
 t->measured=(uint32_t)index;t->received=(uint32_t)count;t->report_at=esp_timer_get_time();
}
static en_stats_snapshot_t en_stats_read(unsigned peer,int64_t timeout,bool online){
 en_stats_snapshot_t value={0};snprintf(value.text,sizeof(value.text),"--");if(peer>=en_count())return value;
 en_stats_tx_t*t=&en_stats_tx[peer];value.sent=t->measured;value.received=t->received;value.lost=t->measured-t->received;value.pending=t->sent-t->measured;value.sendErrors=t->send_errors;
 value.valid=t->measured&&online&&esp_timer_get_time()-t->report_at<timeout;
 if(t->measured)value.lossPercent=100.0*value.lost/value.sent;
 if(value.valid){unsigned tenths=(unsigned)((1000ULL*value.lost+value.sent/2)/value.sent);snprintf(value.text,sizeof(value.text),"Получено %lu из %lu\nПотери %lu (%u,%u%%)",(unsigned long)value.received,(unsigned long)value.sent,(unsigned long)value.lost,tenths/10,tenths%10);}
 else if(t->measured)snprintf(value.text,sizeof(value.text),"Нет свежего отчета");
 return value;
}
`;
