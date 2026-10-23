// MQTT callbacks copy bounded events. Only flow_worker invokes logic blocks.
export const MQTT_RUNTIME=String.raw`
#define MQ_CLIENT_COUNT @CLIENT_COUNT@
#define MQ_OWNER_COUNT @OWNER_COUNT@
#define MQ_FILTER_COUNT @FILTER_COUNT@
#define MQ_SEND_COUNT @SEND_COUNT@
#define MQ_MEMORY_LIMIT (64u*1024u)
#define MQ_PAYLOAD_LIMIT 4096u
#define MQ_PROPERTIES_LIMIT 16384u
#define MQ_PENDING_LIMIT 32u
#define MQ_QUEUE_LENGTH 24u
enum { MQ_STATE=1,MQ_CONNECTED,MQ_DISCONNECTED,MQ_CLIENT_FAILED,MQ_SENT,MQ_SEND_FAILED,MQ_RECEIVED,MQ_SUBSCRIBED,MQ_UNSUBSCRIBED,MQ_RECEIVE_FAILED };
enum { MQ_OFFLINE=0,MQ_WAITING=1,MQ_CONNECTING=1,MQ_ONLINE=2,MQ_RECONNECTING=3,MQ_ERROR=4 };
static void clex_mq_notify(unsigned kind,unsigned slot,unsigned node);
static unsigned mq_owner_count(void){return MQ_OWNER_COUNT;
}
static unsigned mq_filter_count(void){return MQ_FILTER_COUNT;
}
static unsigned mq_send_count(void){return MQ_SEND_COUNT;
}
typedef struct { const char *component,*host,*client_id,*auto_suffix,*username,*password,*ca,*if_key,*will_topic,*will_payload;
unsigned port,keepalive,reconnect_ms,timeout_ms;
uint32_t expiry,will_delay;
bool v5,tls,router,clean,autoconnect,reconnect,will_retain;
int will_qos;
 } mq_config_t;
static const mq_config_t mq_configs[MQ_CLIENT_COUNT]={@CONFIG@};
typedef struct mq_message { unsigned refs;
size_t length,received;
int id,qos;
bool retain;
char topic[257];
char *properties,*encoded[3];
uint8_t bytes[];
 } mq_message_t;
typedef struct { esp_mqtt_client_handle_t handle;
esp_netif_t *route;
struct ifreq interface;
char auto_id[64],error[160];
int state,reason;
bool connected,wanted,started,attempted,busy,resetting,connecting,reconnecting,disconnecting,id_ready,migrating,force_clean,initial_notice,initial_error;
atomic_uint generation;
atomic_int phase;
int64_t attempt_at,clock_at;
mq_message_t *partial;
atomic_uint drops;
 } mq_client_t;
static mq_client_t mq_clients[MQ_CLIENT_COUNT];
typedef struct {mq_client_t *client;
unsigned generation;
} mq_callback_context_t;
static mq_callback_context_t mq_callback_contexts[MQ_CLIENT_COUNT];
typedef struct {const char *topic,*payload,*properties;
char error[160];
int qos,message_id,reason;
bool retain;
} mq_value_t;
typedef struct {unsigned filter;
int qos;
} mq_owner_filter_t;
typedef struct {unsigned client,node,encoding,count;
bool enabled,settled,evicted;
mq_owner_filter_t filters[16];
mq_message_t *message;
mq_value_t value;
} mq_owner_t;
static mq_owner_t mq_owners[MQ_OWNER_COUNT?MQ_OWNER_COUNT:1]={@OWNERS@};
typedef struct {unsigned client;
const char *topic;
bool no_local,retain_published;
unsigned retain_handling;
int applied,pending,target,reason;
bool blocked;
} mq_filter_t;
static mq_filter_t mq_filters[MQ_FILTER_COUNT?MQ_FILTER_COUNT:1]={@FILTERS@};
typedef struct {unsigned client,node,encoding;
int qos;
bool retain;
int64_t expiry;
int format;
const char *content_type,*response_topic,*correlation,*user_properties;
int message_id,reason;
char error[160];
} mq_sender_t;
static mq_sender_t mq_senders[MQ_SEND_COUNT?MQ_SEND_COUNT:1]={@SENDERS@};
typedef struct {bool used;
unsigned sender,client,request;
int id;
} mq_pending_t;
static mq_pending_t mq_pending[MQ_PENDING_LIMIT];
typedef struct {unsigned client,generation,request,index;
int kind,id,reason,session,target;
char error[160];
mq_message_t *message;
} mq_event_t;
enum { MQ_IO_START=1000,MQ_IO_STOP,MQ_IO_SEND,MQ_IO_FILTER,MQ_IO_RESET,MQ_IO_MIGRATE };
typedef struct {unsigned kind,client,generation,index,request;
int target;
char topic[257];
uint8_t *data;
size_t length;
} mq_command_t;
static QueueHandle_t mq_events,mq_commands;
static mq_event_t mq_early[MQ_PENDING_LIMIT];
static unsigned mq_early_count,mq_request;
static atomic_uint mq_memory;
static atomic_bool mq_pressure;
// The header records every dynamic message/view allocation, including fragmented packets.
typedef union {size_t bytes;
max_align_t align;
} mq_alloc_header_t;
static void *mq_alloc(size_t bytes){
 if(bytes>MQ_MEMORY_LIMIT-sizeof(mq_alloc_header_t)){atomic_store(&mq_pressure,true);
return NULL;
}
size_t total=bytes+sizeof(mq_alloc_header_t);
unsigned used=atomic_load(&mq_memory);
 do{if(total>MQ_MEMORY_LIMIT-used){atomic_store(&mq_pressure,true);
return NULL;
}
}while(!atomic_compare_exchange_weak(&mq_memory,&used,used+(unsigned)total));
 mq_alloc_header_t *h=malloc(total);
if(!h){atomic_store(&mq_pressure,true);
atomic_fetch_sub(&mq_memory,(unsigned)total);
return NULL;
}h->bytes=total;
return h+1;
}
static void mq_free(void *p){if(p){mq_alloc_header_t *h=(mq_alloc_header_t*)p-1;
size_t total=h->bytes;
free(h);
atomic_fetch_sub(&mq_memory,(unsigned)total);
}}
static char *mq_shrink(char *p,size_t bytes){if(!p)return NULL;
mq_alloc_header_t *old=(mq_alloc_header_t*)p-1;
size_t total=bytes+sizeof(*old),before=old->bytes;
if(total>=before)return p;
mq_alloc_header_t *h=realloc(old,total);
if(!h)return p;
h->bytes=total;
atomic_fetch_sub(&mq_memory,(unsigned)(before-total));
return (char*)(h+1);
}
static void mq_message_free(mq_message_t *message){if(message){for(unsigned i=0;i<3;i++)mq_free(message->encoded[i]);
mq_free(message->properties);
mq_free(message);
}}
static void mq_release(mq_message_t *message){if(message&&!--message->refs)mq_message_free(message);
}
static bool mq_utf8(const uint8_t *p,size_t n,bool text){
 for(size_t i=0;i<n;){uint8_t a=p[i++];
if(a<0x80){if(text&&!a)return false;
continue;
}unsigned more;
uint32_t cp,min;
 if(a>=0xc2&&a<=0xdf){more=1;
cp=a&31;
min=0x80;
}else if(a>=0xe0&&a<=0xef){more=2;
cp=a&15;
min=0x800;
}else if(a>=0xf0&&a<=0xf4){more=3;
cp=a&7;
min=0x10000;
}else return false;
 if(i+more>n)return false;
while(more--){uint8_t b=p[i++];
if((b&0xc0)!=0x80)return false;
cp=(cp<<6)|(b&63);
}if(cp<min||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))return false;
 }return true;
}
static bool mq_topic(const char *topic){if(!topic)return false;
size_t n=strnlen(topic,257);
return n&&n<=256&&!strchr(topic,'+')&&!strchr(topic,'#')&&mq_utf8((const uint8_t*)topic,n,true);
}
static bool mq_match(const char *filter,const char *topic){
 if(!strncmp(filter,"$share/",7)){filter=strchr(filter+7,'/');
if(!filter)return false;
filter++;
}
 if(topic[0]=='$'&&(filter[0]=='#'||filter[0]=='+'))return false;
 while(1){if(filter[0]=='#'&&!filter[1])return true;
const char *f=strchr(filter,'/'),*t=strchr(topic,'/');
size_t fn=f?(size_t)(f-filter):strlen(filter),tn=t?(size_t)(t-topic):strlen(topic);
 if(!(fn==1&&filter[0]=='+')&&(fn!=tn||memcmp(filter,topic,fn)))return false;
if(!f)return !t;
if(!t)return !strcmp(f,"/#");
filter=f+1;
topic=t+1;
}
}
static int mq_hex(char c){if(c>='0'&&c<='9')return c-'0';
if(c>='a'&&c<='f')return c-'a'+10;
if(c>='A'&&c<='F')return c-'A'+10;
return -1;
}
static uint8_t *mq_decode(const char *text,unsigned encoding,size_t limit,size_t *length){
 if(!text)return NULL;
size_t n=strnlen(text,limit*2+5);
*length=0;
uint8_t *result=NULL;
 if(!encoding){if(n>limit||!mq_utf8((const uint8_t*)text,n,true))return NULL;
result=mq_alloc(n+1);
if(result){memcpy(result,text,n+1);
*length=n;
}return result;
}
 if(encoding==2){if(n>limit*2||n%2)return NULL;
result=mq_alloc(n/2+1);
if(!result)return NULL;
for(size_t i=0;i<n;i+=2){int a=mq_hex(text[i]),b=mq_hex(text[i+1]);
if(a<0||b<0){mq_free(result);
return NULL;
}result[i/2]=(uint8_t)((a<<4)|b);
}*length=n/2;
result[*length]=0;
return result;
}
 if(n>4*((limit+2)/3)||n%4)return NULL;
for(size_t i=0;i<n;i++){char c=text[i];
if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='+'||c=='/'||(c=='='&&i>=n-2))){return NULL;
}if(c=='='&&i==n-2&&text[n-1]!='=')return NULL;
}
 size_t capacity=n/4*3+1;
result=mq_alloc(capacity);
if(!result)return NULL;
if(mbedtls_base64_decode(result,capacity,length,(const unsigned char*)text,n)||*length>limit){mq_free(result);
return NULL;
}result[*length]=0;
return result;
}
static const char *mq_encoded(mq_message_t *message,unsigned encoding){
 if(!encoding)return mq_utf8(message->bytes,message->length,true)?(const char*)message->bytes:NULL;
if(message->encoded[encoding])return message->encoded[encoding];
 size_t capacity=encoding==2?message->length*2+1:4*((message->length+2)/3)+1;
char *out=mq_alloc(capacity);
if(!out)return NULL;
 if(encoding==2){static const char digits[]="0123456789abcdef";
for(size_t i=0;i<message->length;i++){out[i*2]=digits[message->bytes[i]>>4];
out[i*2+1]=digits[message->bytes[i]&15];
}out[capacity-1]=0;
}
 else{size_t written=0;
if(mbedtls_base64_encode((unsigned char*)out,capacity,&written,message->bytes,message->length)){mq_free(out);
return NULL;
}out[written]=0;
}
 message->encoded[encoding]=out;
return out;
}
typedef struct {char *text;
size_t size,capacity;
bool ok;
} mq_json_t;
static void mq_json_raw(mq_json_t *j,const char *text,size_t n){
 if(!j->ok||n>MQ_PROPERTIES_LIMIT-j->size){j->ok=false;return;}
 size_t needed=j->size+n;
 if(needed>j->capacity){
  size_t capacity=j->capacity?j->capacity:64;
  while(capacity<needed)capacity*=2;
  if(capacity>MQ_PROPERTIES_LIMIT)capacity=MQ_PROPERTIES_LIMIT;
  char *grown=mq_alloc(capacity+1);
  if(!grown){j->ok=false;return;}
  memcpy(grown,j->text,j->size);
  mq_free(j->text);
  j->text=grown;
  j->capacity=capacity;
 }
 memcpy(j->text+j->size,text,n);
 j->size+=n;
 j->text[j->size]=0;
}
static void mq_json_text(mq_json_t *j,const char *text,size_t n){
 mq_json_raw(j,"\"",1);
for(size_t i=0;i<n&&j->ok;i++){unsigned char c=text[i];
if(c=='"'||c=='\\'){char pair[2]={'\\',(char)c};
mq_json_raw(j,pair,2);
}else if(c<32){char escaped[7];
snprintf(escaped,sizeof(escaped),"\\u%04x",c);
mq_json_raw(j,escaped,6);
}else mq_json_raw(j,text+i,1);
}mq_json_raw(j,"\"",1);
}
static char *mq_properties(esp_mqtt_event_handle_t event,bool v5){
 if(!v5){char *empty=mq_alloc(3);
if(empty)memcpy(empty,"{}",3);
return empty;
}
mq_json_t j={.text=mq_alloc(65),.capacity=64,.ok=true};
if(!j.text)return NULL;
j.text[0]=0;
esp_mqtt5_event_property_t *p=event->property;
 if(!v5||!p){mq_json_raw(&j,"{}",strlen("{}"));
return mq_shrink(j.text,j.size+1);
}
 mq_json_raw(&j,"{\"payloadFormatIndicator\":",strlen("{\"payloadFormatIndicator\":"));
mq_json_raw(&j,p->payload_format_indicator?"1":"0",1);
 if(p->content_type&&p->content_type_len>0){if(p->content_type_len>256||!mq_utf8((const uint8_t*)p->content_type,p->content_type_len,true))j.ok=false;
mq_json_raw(&j,",\"contentType\":",strlen(",\"contentType\":"));
mq_json_text(&j,p->content_type,(size_t)p->content_type_len);
}
 if(p->response_topic&&p->response_topic_len>0){if(p->response_topic_len>256||!mq_utf8((const uint8_t*)p->response_topic,p->response_topic_len,true))j.ok=false;
mq_json_raw(&j,",\"responseTopic\":",strlen(",\"responseTopic\":"));
mq_json_text(&j,p->response_topic,(size_t)p->response_topic_len);
}
 if(p->correlation_data_len){if(p->correlation_data_len>256)j.ok=false;
else{char encoded[345];
size_t n=0;
if(mbedtls_base64_encode((unsigned char*)encoded,sizeof(encoded),&n,(const unsigned char*)p->correlation_data,p->correlation_data_len))j.ok=false;
else{mq_json_raw(&j,",\"correlationData\":",strlen(",\"correlationData\":"));
mq_json_text(&j,encoded,n);
}}}
 mq_json_raw(&j,",\"userProperties\":[",strlen(",\"userProperties\":["));
unsigned count=esp_mqtt5_client_get_user_property_count(p->user_property);
 if(count>32)j.ok=false;
else if(count){esp_mqtt5_user_property_item_t items[32]={0};
uint8_t n=(uint8_t)count;
if(esp_mqtt5_client_get_user_property(p->user_property,items,&n)!=ESP_OK){j.ok=false;
n=0;
}
else for(unsigned i=0;i<n;i++){size_t a=items[i].key?strlen(items[i].key):0,b=items[i].value?strlen(items[i].value):0;
if(a>128||b>512||!mq_utf8((const uint8_t*)items[i].key,a,true)||!mq_utf8((const uint8_t*)items[i].value,b,true))j.ok=false;
if(i)mq_json_raw(&j,",",strlen(","));
mq_json_raw(&j,"{\"key\":",strlen("{\"key\":"));
mq_json_text(&j,items[i].key,a);
mq_json_raw(&j,",\"value\":",strlen(",\"value\":"));
mq_json_text(&j,items[i].value,b);
mq_json_raw(&j,"}",strlen("}"));
}for(unsigned i=0;i<n;i++){free((void*)items[i].key);
free((void*)items[i].value);
}}
 mq_json_raw(&j,"]}",strlen("]}"));
if(!j.ok){mq_free(j.text);
return NULL;
}return mq_shrink(j.text,j.size+1);
}
static void mq_post(mq_client_t *client,mq_event_t *event){event->client=(unsigned)(client-mq_clients);
if(!event->generation)event->generation=atomic_load(&client->generation);
if(!mq_events||xQueueSend(mq_events,event,0)!=pdTRUE){mq_message_free(event->message);
atomic_fetch_add(&client->drops,1);
}}
static void mq_callback_failure(mq_client_t *client,const char *reason){mq_event_t event={.kind=MQTT_EVENT_ERROR,.generation=mq_callback_contexts[client-mq_clients].generation};
snprintf(event.error,sizeof(event.error),"%s",reason);
mq_post(client,&event);
}
static void mq_callback(void *argument,esp_event_base_t base,int32_t id,void *data){
 (void)base;
mq_callback_context_t *context=argument;
mq_client_t *client=context->client;
esp_mqtt_event_handle_t input=data;
if(!client||!input)return;
mq_event_t event={.generation=context->generation,.kind=(int)id,.id=input->msg_id,.reason=(int)input->reason_code,.session=input->session_present};
if(id==MQTT_EVENT_BEFORE_CONNECT)atomic_store(&client->phase,1);
else if(id==MQTT_EVENT_CONNECTED)atomic_store(&client->phase,2);
else if(id==MQTT_EVENT_DISCONNECTED)atomic_store(&client->phase,3);
 if(id==MQTT_EVENT_DATA){
  if(input->current_data_offset==0){mq_message_free(client->partial);
client->partial=NULL;
   if(input->total_data_len<0||input->total_data_len>MQ_PAYLOAD_LIMIT||input->topic_len<1||input->topic_len>256||!mq_utf8((const uint8_t*)input->topic,(size_t)input->topic_len,true)){mq_callback_failure(client,"MQTT incoming topic/payload exceeds limit or is invalid");
return;
}
   mq_message_t *message=mq_alloc(sizeof(*message)+(size_t)input->total_data_len+1);
if(!message){mq_callback_failure(client,"MQTT receive memory limit reached");
return;
}memset(message,0,sizeof(*message));
message->refs=1;
message->length=(size_t)input->total_data_len;
message->id=input->msg_id;
message->qos=input->qos;
message->retain=input->retain;
memcpy(message->topic,input->topic,(size_t)input->topic_len);
message->topic[input->topic_len]=0;
   // Property pointers belong to ESP-MQTT and must be copied before this callback returns.
   message->properties=mq_properties(input,mq_configs[client-mq_clients].v5);
if(!message->properties){mq_message_free(message);
mq_callback_failure(client,"MQTT properties exceed limit or memory is unavailable");
return;
}client->partial=message;
  }
  mq_message_t *message=client->partial;
if(!message)return;
  if(input->current_data_offset<0||(size_t)input->current_data_offset!=message->received||input->data_len<0||(size_t)input->data_len>message->length-message->received){mq_message_free(message);
client->partial=NULL;
mq_callback_failure(client,"MQTT invalid payload fragment");
return;
}
  if(input->data_len)memcpy(message->bytes+message->received,input->data,(size_t)input->data_len);
message->received+=(size_t)input->data_len;
  if(message->received==message->length){message->bytes[message->length]=0;
client->partial=NULL;
event.message=message;
mq_post(client,&event);
}return;
 }
 if(id==MQTT_EVENT_DISCONNECTED){mq_message_free(client->partial);
client->partial=NULL;
}
 if(id==MQTT_EVENT_SUBSCRIBED&&input->data&&input->data_len)event.reason=(unsigned char)input->data[0];
 if(id==MQTT_EVENT_ERROR){esp_mqtt_error_codes_t *error=input->error_handle;
if(error){if(error->error_type==MQTT_ERROR_TYPE_CONNECTION_REFUSED){event.reason=input->reason_code?input->reason_code:error->connect_return_code;
snprintf(event.error,sizeof(event.error),"MQTT connection refused (reason 0x%02x)",event.reason);
}else if(error->error_type==MQTT_ERROR_TYPE_TCP_TRANSPORT)snprintf(event.error,sizeof(event.error),"MQTT transport error: esp=0x%x tls=0x%x verify=0x%x socket=%d",error->esp_tls_last_esp_err,(unsigned)error->esp_tls_stack_err,error->esp_tls_cert_verify_flags,error->esp_transport_sock_errno);
else snprintf(event.error,sizeof(event.error),"MQTT protocol error type=%d (reason 0x%02x)",(int)error->error_type,event.reason);
}else snprintf(event.error,sizeof(event.error),"MQTT protocol error (reason 0x%02x)",event.reason);
}
 if(id==MQTT_EVENT_CONNECTED||id==MQTT_EVENT_DISCONNECTED||id==MQTT_EVENT_BEFORE_CONNECT||id==MQTT_EVENT_ERROR||id==MQTT_EVENT_SUBSCRIBED||id==MQTT_EVENT_UNSUBSCRIBED||id==MQTT_EVENT_PUBLISHED||id==MQTT_EVENT_DELETED)mq_post(client,&event);
}
static void mq_state(unsigned slot,int state){mq_client_t *client=&mq_clients[slot];
if(client->state!=state){client->state=state;
clex_mq_notify(MQ_STATE,slot,0);
}}
static void mq_error(unsigned slot,const char *error,int reason){mq_client_t *client=&mq_clients[slot];
snprintf(client->error,sizeof(client->error),"%s",error);
client->reason=reason;
mq_state(slot,MQ_ERROR);
clex_mq_notify(MQ_CLIENT_FAILED,slot,0);
ESP_LOGW("clex_mqtt","connection %u: %s",slot,error);
}
static void mq_sender_result(unsigned sender,int id,int reason,const char *error){mq_sender_t *s=&mq_senders[sender];
s->message_id=id;
s->reason=reason;
snprintf(s->error,sizeof(s->error),"%s",error?error:"");
clex_mq_notify(error?MQ_SEND_FAILED:MQ_SENT,s->client,s->node);
}
static void mq_owner_error(unsigned owner,const char *error,int reason){mq_owner_t *o=&mq_owners[owner];
snprintf(o->value.error,sizeof(o->value.error),"%s",error);
o->value.reason=reason;
clex_mq_notify(MQ_RECEIVE_FAILED,o->client,o->node);
}
static int mq_desired(unsigned filter){int qos=-1;
for(unsigned i=0;i<mq_owner_count();i++){mq_owner_t *owner=&mq_owners[i];
if(owner->enabled)for(unsigned k=0;k<owner->count;k++)if(owner->filters[k].filter==filter&&owner->filters[k].qos>qos)qos=owner->filters[k].qos;
}return qos;
}
static void mq_fail_pending(unsigned slot,const char *reason){for(unsigned i=0;i<MQ_PENDING_LIMIT;i++)if(mq_pending[i].used&&mq_pending[i].client==slot){unsigned sender=mq_pending[i].sender;
int id=mq_pending[i].id;
mq_pending[i].used=false;
mq_sender_result(sender,id,0,reason);
}}
static void mq_filter_failure(unsigned filter,int reason,const char *message){mq_filter_t *f=&mq_filters[filter];
f->pending=0;
f->blocked=true;
f->reason=reason;
for(unsigned i=0;i<mq_owner_count();i++){mq_owner_t *o=&mq_owners[i];
if(o->client!=f->client)continue;
for(unsigned k=0;k<o->count;k++)if(o->filters[k].filter==filter){o->settled=true;
mq_owner_error(i,message,reason);
break;
}}}
static void mq_settle_owners(unsigned slot){
 for(unsigned i=0;i<mq_owner_count();i++){mq_owner_t *o=&mq_owners[i];
if(o->client!=slot||o->settled)continue;
bool complete=true;
for(unsigned k=0;k<o->count;k++){mq_filter_t *f=&mq_filters[o->filters[k].filter];
if(f->blocked){complete=false;
break;
}if(o->enabled&&(f->pending||f->applied<o->filters[k].qos)){complete=false;
break;
}if(!o->enabled&&mq_desired(o->filters[k].filter)<0&&(f->pending||f->applied!=-1)){complete=false;
break;
}}
  if(complete){o->settled=true;
o->value.error[0]=0;
o->value.reason=0;
clex_mq_notify(o->enabled?MQ_SUBSCRIBED:MQ_UNSUBSCRIBED,slot,o->node);
}
 }
}
static bool mq_queue_command(mq_command_t *command){if(command&&mq_commands&&xQueueSend(mq_commands,&command,0)==pdTRUE)return true;
if(command){mq_free(command->data);
mq_free(command);
}return false;
}
static mq_command_t *mq_command(unsigned kind,unsigned slot){mq_command_t *c=mq_alloc(sizeof(*c));
if(c){memset(c,0,sizeof(*c));
c->kind=kind;
c->client=slot;
c->generation=atomic_load(&mq_clients[slot].generation);
}return c;
}
static void mq_reconcile(unsigned slot){
 mq_client_t *client=&mq_clients[slot];
if(!client->connected)return;
 for(unsigned i=0;i<mq_filter_count();i++){mq_filter_t *f=&mq_filters[i];
if(f->client!=slot||f->pending||f->blocked)continue;
int desired=mq_desired(i);
if(desired==f->applied)continue;
  mq_command_t *command=mq_command(MQ_IO_FILTER,slot);
if(command){command->index=i;
command->target=desired;
}if(mq_queue_command(command)){f->pending=-1;
f->target=desired;
}else break;

 }
 mq_settle_owners(slot);
}
static void mq_reset_client(unsigned slot){
 mq_client_t *client=&mq_clients[slot];
if(client->handle){if(client->started)esp_mqtt_client_stop(client->handle);
esp_mqtt_client_destroy(client->handle);
}client->handle=NULL;
client->started=false;
mq_message_free(client->partial);
client->partial=NULL;
}
static bool mq_clock_ready(void){
 if(time(NULL)>=1704067200)return true;
 if(!esp_sntp_enabled()){esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
esp_sntp_setservername(0,"pool.ntp.org");
esp_sntp_init();
}
 return false;
}
static esp_netif_t *mq_route(unsigned slot){const mq_config_t *p=&mq_configs[slot];
if(p->router){@ROUTER_NETWORK@}return p->if_key[0]?esp_netif_get_handle_from_ifkey(p->if_key):esp_netif_get_default_netif();
}
static bool mq_network_up(esp_netif_t *netif){esp_netif_ip_info_t info;
return netif&&esp_netif_is_netif_up(netif)&&esp_netif_get_ip_info(netif,&info)==ESP_OK&&info.ip.addr!=0;
}
static bool mq_network(unsigned slot){const mq_config_t *config=&mq_configs[slot];
esp_netif_t *netif=mq_route(slot);
if(!mq_network_up(netif))return false;
if((config->if_key[0]||config->router)&&esp_netif_get_netif_impl_name(netif,mq_clients[slot].interface.ifr_name)!=ESP_OK)return false;
mq_clients[slot].route=netif;
return true;
}
static esp_err_t mq_create(unsigned slot){
 const mq_config_t *p=&mq_configs[slot];
mq_client_t *client=&mq_clients[slot];
esp_mqtt_client_config_t config={.broker.address={.hostname=p->host,.transport=p->tls?MQTT_TRANSPORT_OVER_SSL:MQTT_TRANSPORT_OVER_TCP,.port=p->port},.credentials={.username=(p->username[0]||p->password[0])?p->username:NULL,.client_id=p->client_id[0]?p->client_id:client->auto_id,.authentication.password=p->password[0]?p->password:NULL},.session={.disable_clean_session=!(p->clean||client->force_clean),.keepalive=(int)p->keepalive,.disable_keepalive=p->keepalive==0,.protocol_ver=p->v5?MQTT_PROTOCOL_V_5:MQTT_PROTOCOL_V_3_1_1,.last_will={.topic=!client->force_clean&&p->will_topic[0]?p->will_topic:NULL,.msg=p->will_payload,.msg_len=(int)strlen(p->will_payload),.qos=p->will_qos,.retain=p->will_retain}},.network={.disable_auto_reconnect=true,.timeout_ms=(int)p->timeout_ms,.reconnect_timeout_ms=(int)p->reconnect_ms,.if_name=(p->if_key[0]||p->router)?&client->interface:NULL},.task={.priority=4,.stack_size=8192},.buffer={.size=8192,.out_size=8192},.outbox.limit=16384};
 if(p->tls){if(p->ca[0])config.broker.verification.certificate=p->ca;
else config.broker.verification.crt_bundle_attach=esp_crt_bundle_attach;
config.broker.verification.skip_cert_common_name_check=false;
}
 client->handle=esp_mqtt_client_init(&config);
if(!client->handle)return ESP_ERR_NO_MEM;
 mq_callback_contexts[slot]=(mq_callback_context_t){.client=client,.generation=atomic_load(&client->generation)};
esp_err_t err=esp_mqtt_client_register_event(client->handle,ESP_EVENT_ANY_ID,mq_callback,&mq_callback_contexts[slot]);
 if(err==ESP_OK&&p->v5){esp_mqtt5_connection_property_config_t properties={.session_expiry_interval=client->force_clean?0:p->expiry,.will_delay_interval=client->force_clean?0:p->will_delay,.maximum_packet_size=16384,.receive_maximum=16,.request_problem_info=true};
err=esp_mqtt5_client_set_connect_property(client->handle,&properties);
}
 if(err!=ESP_OK){esp_mqtt_client_destroy(client->handle);
client->handle=NULL;
return err;
}return ESP_OK;
}
static void __attribute__((unused)) clex_mq_connect(unsigned slot){if(slot>=MQ_CLIENT_COUNT)return;
mq_client_t *client=&mq_clients[slot];
if(!client->id_ready){mq_error(slot,"MQTT factory MAC is unavailable; configure Client ID",0);
return;
}
client->wanted=true;
client->attempted=false;
client->reconnecting=false;
client->attempt_at=0;
if(!client->connected)mq_state(slot,MQ_WAITING);
}
static void __attribute__((unused)) clex_mq_disconnect(unsigned slot){
 if(slot>=MQ_CLIENT_COUNT)return;
mq_client_t *client=&mq_clients[slot];
client->wanted=false;
 if(!client->disconnecting){mq_command_t *command=mq_command(MQ_IO_STOP,slot);
if(mq_queue_command(command))client->disconnecting=true;
else mq_error(slot,"MQTT command queue/memory is full",0);
}

}
static void __attribute__((unused)) clex_mq_subscribe(unsigned owner,bool enabled){if(owner>=mq_owner_count())return;
mq_owner_t *o=&mq_owners[owner];
o->enabled=enabled;
o->settled=false;
o->value.error[0]=0;
for(unsigned k=0;k<o->count;k++)mq_filters[o->filters[k].filter].blocked=false;
if(mq_clients[o->client].connected)mq_reconcile(o->client);
}
static void __attribute__((unused)) clex_mq_send(unsigned sender,const char *topic,const char *payload){
 if(sender>=mq_send_count())return;
mq_sender_t *s=&mq_senders[sender];
mq_client_t *client=&mq_clients[s->client];
 if(!client->connected||!client->wanted){mq_sender_result(sender,-1,0,"MQTT is not connected");
return;
}if(!mq_topic(topic)){mq_sender_result(sender,-1,0,"MQTT topic must be valid UTF-8, 1-256 bytes, without + or #");
return;
}
 size_t length=0;
uint8_t *data=mq_decode(payload,s->encoding,MQ_PAYLOAD_LIMIT,&length);
if(!data){mq_sender_result(sender,-1,0,"MQTT payload encoding/size is invalid or memory limit reached");
return;
}if(s->format==1&&!mq_utf8(data,length,false)){mq_free(data);
mq_sender_result(sender,-1,0,"MQTT Payload Format Indicator requires valid UTF-8");
return;
}
 unsigned pending=MQ_PENDING_LIMIT;
for(unsigned i=0;i<MQ_PENDING_LIMIT;i++)if(!mq_pending[i].used){pending=i;
break;
}if(pending==MQ_PENDING_LIMIT){mq_free(data);
mq_sender_result(sender,-1,0,"MQTT pending publication limit reached");
return;
}
 mq_command_t *command=mq_command(MQ_IO_SEND,s->client);
if(command){command->index=sender;
command->request=++mq_request;
command->data=data;
command->length=length;
snprintf(command->topic,sizeof(command->topic),"%s",topic);
}else mq_free(data);
 if(!command){mq_sender_result(sender,-1,0,"MQTT command memory limit reached");
return;
}unsigned request=command->request;
 if(!mq_queue_command(command)){mq_sender_result(sender,-1,0,"MQTT command queue is full");
return;
}s->message_id=-1;
s->error[0]=0;
s->reason=0;
 mq_pending[pending]=(mq_pending_t){.used=true,.sender=sender,.client=s->client,.id=-1,.request=request};
}
static void mq_io_send(mq_command_t *command,mq_event_t *result){
 mq_sender_t *s=&mq_senders[command->index];
mq_client_t *client=&mq_clients[command->client];
 esp_mqtt5_publish_property_config_t property={0};
mqtt5_user_property_handle_t user=NULL;
uint8_t *correlation=NULL;
cJSON *json=NULL;
esp_err_t err=ESP_OK;
 if(mq_configs[s->client].v5){
  property.payload_format_indicator=s->format==1;
property.payload_format_indicator_set=s->format>=0;
property.message_expiry_interval=s->expiry<0?0:(uint32_t)s->expiry;
property.message_expiry_interval_set=s->expiry>=0;
property.content_type=s->content_type[0]?s->content_type:NULL;
property.response_topic=s->response_topic[0]?s->response_topic:NULL;
  size_t n=0;
if(s->correlation[0]){correlation=mq_decode(s->correlation,1,256,&n);
if(!correlation)err=ESP_ERR_NO_MEM;
property.correlation_data=(const char*)correlation;
property.correlation_data_len=(uint16_t)n;
}
  json=cJSON_Parse(s->user_properties);
if(!json||!cJSON_IsArray(json)||cJSON_GetArraySize(json)>32)err=ESP_ERR_INVALID_ARG;
  if(err==ESP_OK&&cJSON_GetArraySize(json)){esp_mqtt5_user_property_item_t items[32];
unsigned count=0;
const cJSON *item=NULL;
cJSON_ArrayForEach(item,json){const cJSON *key=cJSON_GetObjectItemCaseSensitive(item,"key"),*value=cJSON_GetObjectItemCaseSensitive(item,"value");
if(!cJSON_IsString(key)||!cJSON_IsString(value)){err=ESP_ERR_INVALID_ARG;
break;
}items[count++]=(esp_mqtt5_user_property_item_t){.key=key->valuestring,.value=value->valuestring};
}if(err==ESP_OK)err=esp_mqtt5_client_set_user_property(&user,items,(uint8_t)count);
}
  property.user_property=user;
if(err==ESP_OK)err=esp_mqtt5_client_set_publish_property(client->handle,&property);
 }
 int id=-1;
if(err==ESP_OK&&client->handle)id=esp_mqtt_client_enqueue(client->handle,command->topic,(const char*)command->data,(int)command->length,s->qos,s->retain,true);
 if(user)esp_mqtt5_client_delete_user_property(user);
cJSON_Delete(json);
mq_free(correlation);
result->id=id;
if(id<0)snprintf(result->error,sizeof(result->error),"%s",id==-2?"MQTT publication outbox is full":"MQTT publication failed");
}
static void mq_io_filter(mq_command_t *command,mq_event_t *result){
 mq_filter_t *f=&mq_filters[command->index];
mq_client_t *client=&mq_clients[command->client];
int desired=command->target,id=-1;
 if(!client->handle){result->id=-1;
return;
}
 if(mq_configs[command->client].v5){if(desired>=0){esp_mqtt5_subscribe_property_config_t p={.no_local_flag=f->no_local,.retain_as_published_flag=f->retain_published,.retain_handle=(uint8_t)f->retain_handling};
if(esp_mqtt5_client_set_subscribe_property(client->handle,&p)==ESP_OK)id=esp_mqtt_client_subscribe_single(client->handle,f->topic,desired);
}else{esp_mqtt5_unsubscribe_property_config_t p={0};
if(esp_mqtt5_client_set_unsubscribe_property(client->handle,&p)==ESP_OK)id=esp_mqtt_client_unsubscribe(client->handle,f->topic);
}}
 else id=desired>=0?esp_mqtt_client_subscribe_single(client->handle,f->topic,desired):esp_mqtt_client_unsubscribe(client->handle,f->topic);
 result->id=id;
}
static esp_err_t mq_io_migrate(unsigned slot){
 mq_client_t *client=&mq_clients[slot];
 if(!client->handle||!client->started)return ESP_OK;
 int64_t deadline=esp_timer_get_time()+((int64_t)mq_configs[slot].timeout_ms*2+1000)*1000;
 do{
  if(atomic_load(&client->phase)==3)return ESP_OK;
  esp_err_t error=esp_mqtt_client_disconnect(client->handle);
  if(error!=ESP_OK)return error;
  vTaskDelay(pdMS_TO_TICKS(20));
 }while(esp_timer_get_time()<deadline);
 return ESP_ERR_TIMEOUT;
}
static void mq_io_worker(void *unused){
 (void)unused;
mq_command_t *command=NULL;
 for(;;){if(xQueueReceive(mq_commands,&command,portMAX_DELAY)!=pdTRUE)continue;
mq_client_t *client=&mq_clients[command->client];
  if(command->generation==atomic_load(&client->generation)){
   mq_event_t result={.kind=(int)command->kind,.client=command->client,.generation=command->generation,.index=command->index,.request=command->request,.target=command->target};
   switch(command->kind){
   case MQ_IO_START:{esp_err_t err=ESP_OK;
if(!client->handle)err=mq_create(command->client);
if(err==ESP_OK){if(client->started){err=clex_mqtt_client_set_network_interface(client->handle,(mq_configs[command->client].if_key[0]||mq_configs[command->client].router)?&client->interface:NULL);
if(err==ESP_OK)err=esp_mqtt_client_reconnect(client->handle);
}else err=esp_mqtt_client_start(client->handle);
if(err==ESP_OK)client->started=true;
}result.id=err;
if(err!=ESP_OK)snprintf(result.error,sizeof(result.error),"MQTT start/reconnect: %s",esp_err_to_name(err));
break;
}
   case MQ_IO_STOP:result.id=client->handle&&client->started?esp_mqtt_client_disconnect(client->handle):ESP_OK;
break;
   case MQ_IO_MIGRATE:result.id=mq_io_migrate(command->client);
break;
   case MQ_IO_RESET:mq_reset_client(command->client);
break;
   case MQ_IO_SEND:mq_io_send(command,&result);
break;
   case MQ_IO_FILTER:mq_io_filter(command,&result);
break;
   default:break;
   }
   mq_post(client,&result);
  }
  mq_free(command->data);
mq_free(command);
 }
}

static void mq_deliver(unsigned slot,mq_message_t *message){
 for(unsigned i=0;i<mq_owner_count();i++){mq_owner_t *o=&mq_owners[i];
if(o->client!=slot||!o->enabled)continue;
bool matches=false;
for(unsigned k=0;k<o->count;k++)if(mq_match(mq_filters[o->filters[k].filter].topic,message->topic)){matches=true;
break;
}if(!matches)continue;
  const char *payload=mq_encoded(message,o->encoding);
if(!payload){mq_owner_error(i,o->encoding?"MQTT receive memory limit reached":"MQTT payload is binary; select Base64 or hex",0);
continue;
}
  mq_release(o->message);
o->message=message;
message->refs++;
o->value.topic=message->topic;
o->value.payload=payload;
o->value.properties=message->properties;
o->value.qos=message->qos;
o->value.retain=message->retain;
o->value.message_id=message->id;
o->value.reason=0;
o->value.error[0]=0;
clex_mq_notify(MQ_RECEIVED,slot,o->node);
 }
}
static void mq_handle(mq_event_t *event);
static void mq_replay_early(unsigned slot,int id){for(unsigned i=0;i<mq_early_count;i++)if(mq_early[i].client==slot&&mq_early[i].id==id){mq_event_t event=mq_early[i];
mq_early[i]=mq_early[--mq_early_count];
mq_handle(&event);
return;
}}
static void mq_save_early(mq_event_t *event){bool pending=false;
if(event->kind==MQTT_EVENT_PUBLISHED||event->kind==MQTT_EVENT_DELETED){for(unsigned i=0;i<MQ_PENDING_LIMIT;i++)if(mq_pending[i].used&&mq_pending[i].client==event->client&&mq_pending[i].id==-1){pending=true;
break;
}}if(event->kind==MQTT_EVENT_SUBSCRIBED||event->kind==MQTT_EVENT_UNSUBSCRIBED||event->kind==MQTT_EVENT_DELETED){for(unsigned i=0;i<mq_filter_count();i++)if(mq_filters[i].client==event->client&&mq_filters[i].pending==-1){pending=true;
break;
}}if(!pending)return;
if(mq_early_count<MQ_PENDING_LIMIT)mq_early[mq_early_count++]=*event;
else atomic_fetch_add(&mq_clients[event->client].drops,1);
}
static void mq_handle(mq_event_t *event){
 unsigned slot=event->client;
mq_client_t *client=&mq_clients[slot];
if(event->generation!=atomic_load(&client->generation)){mq_release(event->message);
return;
}
 switch(event->kind){
 case MQ_IO_START:client->busy=false;
if(event->id!=ESP_OK){client->connecting=false;
mq_error(slot,event->error,0);
if(!mq_configs[slot].reconnect)client->wanted=false;
}break;
 case MQ_IO_STOP:if(event->id==ESP_OK&&atomic_load(&client->phase)!=1&&atomic_load(&client->phase)!=2)client->disconnecting=false;
if(event->id!=ESP_OK){client->disconnecting=false;
mq_error(slot,"MQTT disconnect request failed",0);
}
else if(!client->connected)mq_state(slot,MQ_OFFLINE);
break;
 case MQ_IO_MIGRATE:client->busy=false;
if(event->id==ESP_OK)client->migrating=false;
else{client->attempt_at=esp_timer_get_time();
mq_error(slot,"MQTT network migration waits for disconnect",0);
}
break;
 case MQ_IO_RESET:client->busy=false;
client->resetting=false;
break;
 case MQ_IO_SEND:{mq_sender_t *s=&mq_senders[event->index];
for(unsigned i=0;i<MQ_PENDING_LIMIT;i++)if(mq_pending[i].used&&mq_pending[i].request==event->request&&mq_pending[i].client==slot){if(event->id<0){mq_pending[i].used=false;
mq_sender_result(event->index,event->id,0,event->error);
}else if(!s->qos){mq_pending[i].used=false;
mq_sender_result(event->index,event->id,0,NULL);
}else{mq_pending[i].id=event->id;
s->message_id=event->id;
mq_replay_early(slot,event->id);
}break;
}

break;
}
 case MQ_IO_FILTER:{mq_filter_t *f=&mq_filters[event->index];
if(event->id<0)mq_filter_failure(event->index,0,event->id==-2?"MQTT subscription outbox is full":"MQTT subscription request failed");
else{f->pending=event->id;
mq_replay_early(slot,event->id);
}break;
}

 case MQTT_EVENT_BEFORE_CONNECT:mq_state(slot,client->reconnecting?MQ_RECONNECTING:MQ_CONNECTING);
break;
 case MQTT_EVENT_CONNECTED:{client->connecting=false;
client->disconnecting=false;
if(client->force_clean){
 client->force_clean=false;
 client->connected=false;
 client->resetting=true;
 client->busy=false;
 client->attempted=false;
 client->attempt_at=esp_timer_get_time();
 atomic_fetch_add(&client->generation,1);
 break;
}
if(!client->wanted||client->migrating){client->connected=true;
client->disconnecting=false;
break;
}
client->reconnecting=false;
client->connected=true;
client->error[0]=0;
client->reason=0;
mq_state(slot,MQ_ONLINE);
for(unsigned i=0;i<mq_filter_count();i++)if(mq_filters[i].client==slot){mq_filters[i].pending=0;
mq_filters[i].blocked=false;
mq_filters[i].applied=event->session?-2:-1;
}for(unsigned i=0;i<mq_owner_count();i++)if(mq_owners[i].client==slot&&mq_owners[i].enabled)mq_owners[i].settled=false;
clex_mq_notify(MQ_CONNECTED,slot,0);
mq_reconcile(slot);
break;
}
 case MQTT_EVENT_DISCONNECTED:{client->disconnecting=false;
client->connecting=false;
bool was=client->connected;
client->connected=false;
client->attempt_at=esp_timer_get_time();
client->reason=event->reason;
if(!mq_configs[slot].reconnect)client->wanted=false;
client->reconnecting=client->wanted;
mq_state(slot,client->wanted?MQ_RECONNECTING:MQ_OFFLINE);
if(was||client->attempted)clex_mq_notify(MQ_DISCONNECTED,slot,0);
if(event->reason>=0x80){char error[96];
snprintf(error,sizeof(error),"MQTT broker disconnected (reason 0x%02x)",event->reason);
mq_error(slot,error,event->reason);
}break;
}
 case MQTT_EVENT_ERROR:client->connecting=false;
mq_error(slot,event->error[0]?event->error:"MQTT error",event->reason);
break;
 case MQTT_EVENT_DATA:if(client->wanted&&!client->migrating&&client->connected)mq_deliver(slot,event->message);
break;
 case MQTT_EVENT_PUBLISHED:case MQTT_EVENT_DELETED:{bool deleted=event->kind==MQTT_EVENT_DELETED,found=false;
for(unsigned i=0;i<MQ_PENDING_LIMIT;i++)if(mq_pending[i].used&&mq_pending[i].client==slot&&mq_pending[i].id==event->id){found=true;
unsigned sender=mq_pending[i].sender;
mq_pending[i].used=false;
char error[96];
snprintf(error,sizeof(error),deleted?"MQTT publication expired in outbox":"MQTT publication rejected (reason 0x%02x)",event->reason);
mq_sender_result(sender,event->id,event->reason,deleted||event->reason>=0x80?error:NULL);
break;
}if(deleted)for(unsigned i=0;i<mq_filter_count();i++)if(mq_filters[i].client==slot&&mq_filters[i].pending==event->id){found=true;
mq_filter_failure(i,0,"MQTT subscription request expired");
}if(!found&&deleted&&event->id==0)mq_error(slot,"MQTT queued QoS0 message expired before transmission",0);
else if(!found)mq_save_early(event);
break;
}
 case MQTT_EVENT_SUBSCRIBED:case MQTT_EVENT_UNSUBSCRIBED:{bool found=false;
for(unsigned i=0;i<mq_filter_count();i++){mq_filter_t *f=&mq_filters[i];
if(f->client!=slot||f->pending!=event->id)continue;
found=true;
if(event->reason>=0x80){char error[96];
snprintf(error,sizeof(error),"MQTT subscription rejected (reason 0x%02x)",event->reason);
mq_filter_failure(i,event->reason,error);
}else{f->pending=0;
f->applied=f->target;
f->reason=event->reason;
}break;
}if(found)mq_reconcile(slot);
else mq_save_early(event);
break;
}

 default:break;
 }
 mq_release(event->message);
}
static void clex_mq_initialize(void){
 for(unsigned i=0;i<mq_owner_count();i++){
  mq_owners[i].value.topic="";
  mq_owners[i].value.payload="";
  mq_owners[i].value.properties="{}";
  mq_owners[i].settled=!mq_owners[i].enabled;
 }
 mq_events=xQueueCreate(MQ_QUEUE_LENGTH,sizeof(mq_event_t));
 mq_commands=xQueueCreate(16,sizeof(mq_command_t*));
 if(mq_commands&&xTaskCreate(mq_io_worker,"clex_mqtt_io",8192,NULL,4,NULL)!=pdPASS){vQueueDelete(mq_commands);
mq_commands=NULL;
}
 uint8_t mac[6]={0};
 esp_err_t mac_error=esp_efuse_mac_get_default(mac);
 for(unsigned i=0;i<MQ_CLIENT_COUNT;i++){
  mq_client_t *client=&mq_clients[i];
  client->generation=1;
  client->wanted=mq_configs[i].autoconnect;
  client->id_ready=mac_error==ESP_OK||mq_configs[i].client_id[0];
  client->initial_notice=true;
  snprintf(client->auto_id,sizeof(client->auto_id),"cfx%02x%02x%02x%02x%02x%02x%s",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5],mq_configs[i].auto_suffix);
  if(!mq_events||!mq_commands||!client->id_ready){
   client->wanted=false;
   client->state=MQ_ERROR;
   client->initial_error=true;
   snprintf(client->error,sizeof(client->error),"%s",!mq_events||!mq_commands?"MQTT task/queue allocation failed":"MQTT factory MAC is unavailable; configure Client ID");
  }else client->state=client->wanted?MQ_WAITING:MQ_OFFLINE;
 }
}
static void mq_evict_views(void){
 // Callbacks never release graph-visible data. Clear every pointer before notifying any block.
 for(unsigned i=0;i<mq_owner_count();i++){
  mq_owner_t *owner=&mq_owners[i];
  owner->evicted=owner->message!=NULL;
  mq_message_t *message=owner->message;
  owner->message=NULL;
  owner->value.topic="";
  owner->value.payload="";
  owner->value.properties="{}";
  owner->value.message_id=0;
  owner->value.qos=0;
  owner->value.retain=false;
  mq_release(message);
 }
 for(unsigned i=0;i<mq_owner_count();i++)if(mq_owners[i].evicted){mq_owners[i].evicted=false;
mq_owner_error(i,"MQTT receive view released after memory pressure; retry incoming message",0);
}
}
static void clex_mq_poll(void){
 for(unsigned i=0;i<MQ_CLIENT_COUNT;i++)if(mq_clients[i].initial_notice){
  mq_clients[i].initial_notice=false;
  clex_mq_notify(MQ_STATE,i,0);
  if(mq_clients[i].initial_error){mq_clients[i].initial_error=false;
clex_mq_notify(MQ_CLIENT_FAILED,i,0);
ESP_LOGW("clex_mqtt","connection %u: %s",i,mq_clients[i].error);
}
 }
 if(atomic_exchange(&mq_pressure,false))mq_evict_views();
 if(!mq_events)return;
mq_event_t event;
for(unsigned i=0;i<MQ_QUEUE_LENGTH&&xQueueReceive(mq_events,&event,0)==pdTRUE;i++)mq_handle(&event);
 int64_t now=esp_timer_get_time();
for(unsigned slot=0;slot<MQ_CLIENT_COUNT;slot++){mq_client_t *client=&mq_clients[slot];
const mq_config_t *config=&mq_configs[slot];
unsigned dropped=atomic_exchange(&client->drops,0);
bool route_changed=client->connected&&(mq_route(slot)!=client->route||!mq_network_up(client->route));
if(route_changed&&!dropped){client->connected=false;
client->connecting=false;
client->reconnecting=true;
client->migrating=true;
client->busy=false;
client->attempt_at=0;
if(!config->reconnect)client->wanted=false;
mq_state(slot,client->wanted?MQ_RECONNECTING:MQ_OFFLINE);
}
if(dropped){bool was=client->connected;
client->connected=false;
client->connecting=false;
client->reconnecting=true;
client->resetting=true;
client->force_clean=true;
client->migrating=false;
client->busy=false;
atomic_fetch_add(&client->generation,1);
const char *reason="MQTT event queue overflow; delivery unknown; broker session will be reset";
mq_fail_pending(slot,reason);
mq_error(slot,reason,0);
if(was)clex_mq_notify(MQ_DISCONNECTED,slot,0);
client->attempt_at=now;
client->attempted=false;
for(unsigned i=0;i<mq_filter_count();i++)if(mq_filters[i].client==slot){mq_filters[i].pending=0;
mq_filters[i].applied=-2;
mq_filters[i].blocked=false;
}for(unsigned i=0;i<mq_early_count;)if(mq_early[i].client==slot)mq_early[i]=mq_early[--mq_early_count];
else i++;
if(!config->reconnect)client->wanted=false;
}
  if(client->migrating){
   if(!client->busy&&(!client->attempt_at||now-client->attempt_at>=(int64_t)config->reconnect_ms*1000)){
    mq_command_t *command=mq_command(MQ_IO_MIGRATE,slot);
    if(mq_queue_command(command))client->busy=true;
   }
   continue;
  }
  if(client->resetting){if(!client->busy){mq_command_t *command=mq_command(MQ_IO_RESET,slot);
if(mq_queue_command(command))client->busy=true;
}continue;
}
  if(client->connected){if(!client->wanted){if(!client->disconnecting){mq_command_t *command=mq_command(MQ_IO_STOP,slot);
if(mq_queue_command(command))client->disconnecting=true;
}continue;
}mq_reconcile(slot);
continue;
}if(!client->wanted||client->busy||client->connecting)continue;
  if(client->attempt_at&&now-client->attempt_at<(int64_t)config->reconnect_ms*1000)continue;
  if(!mq_network(slot)){mq_state(slot,client->reconnecting?MQ_RECONNECTING:MQ_WAITING);
continue;
}if(config->tls&&!mq_clock_ready()){
   if(!client->clock_at)client->clock_at=now;
   if(now-client->clock_at>=(int64_t)config->timeout_ms*1000){
    client->attempt_at=now;
    client->clock_at=now;
    mq_error(slot,"MQTT TLS system clock synchronization timed out",0);
    if(!config->reconnect)client->wanted=false;
   }else if(client->state!=MQ_WAITING||strcmp(client->error,"MQTT TLS waits for synchronized system clock")){
    snprintf(client->error,sizeof(client->error),"MQTT TLS waits for synchronized system clock");
    mq_state(slot,client->reconnecting?MQ_RECONNECTING:MQ_WAITING);
   }
   continue;
  }
  client->clock_at=0;
  if(!strncmp(client->error,"MQTT TLS ",9))client->error[0]=0;

  if(client->attempted&&!config->reconnect)continue;
client->attempt_at=now;
mq_command_t *command=mq_command(MQ_IO_START,slot);
if(mq_queue_command(command)){client->busy=true;
client->connecting=true;
client->attempted=true;
mq_state(slot,client->reconnecting?MQ_RECONNECTING:MQ_CONNECTING);
}else mq_error(slot,"MQTT command queue/memory is full",0);
 }

}
`;
