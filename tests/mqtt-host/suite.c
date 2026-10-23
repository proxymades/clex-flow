// Host integration checks use the production ESP-MQTT component with real sockets.
#include "mqtt_client.h"
#include "mqtt5_client.h"
#include <stdatomic.h>
#include <signal.h>
void host_transport_drop(esp_transport_handle_t transport);
typedef struct {
    atomic_int connected,disconnected,subscribed,unsubscribed,published,errors,received,session,reason,properties,binary;
    pthread_mutex_t lock;
    char topics[64][256],payloads[64][256];
    int retained[64];
} observer;
static void event(void *arg,esp_event_base_t base,int32_t id,void *data){
    (void)base; observer *o=arg; esp_mqtt_event_handle_t e=data;
    switch(id){
    case MQTT_EVENT_CONNECTED:atomic_store(&o->session,e->session_present);atomic_fetch_add(&o->connected,1);break;
    case MQTT_EVENT_DISCONNECTED:atomic_fetch_add(&o->disconnected,1);break;
    case MQTT_EVENT_SUBSCRIBED:assert(e->reason_code<0x80);atomic_fetch_add(&o->subscribed,1);break;
    case MQTT_EVENT_UNSUBSCRIBED:atomic_fetch_add(&o->unsubscribed,1);break;
    case MQTT_EVENT_PUBLISHED:atomic_store(&o->reason,e->reason_code);atomic_fetch_add(&o->published,1);break;
    case MQTT_EVENT_ERROR:atomic_fetch_add(&o->errors,1);break;
    case MQTT_EVENT_DATA:{
        if(e->topic_len==12&&!memcmp(e->topic,"suite/binary",12)){assert(e->data_len==4&&e->data[0]==0&&(unsigned char)e->data[1]==255&&e->data[2]==1&&e->data[3]==0);atomic_fetch_add(&o->binary,1);}
        if(e->topic_len==16&&!memcmp(e->topic,"suite/properties",16)){
            assert(e->property&&e->property->payload_format_indicator==1);assert(e->property->content_type_len==10&&!memcmp(e->property->content_type,"text/plain",10));assert(e->property->response_topic_len==11&&!memcmp(e->property->response_topic,"reply/value",11));assert(e->property->correlation_data_len==2&&e->property->correlation_data[0]==0&&(unsigned char)e->property->correlation_data[1]==255);
            esp_mqtt5_user_property_item_t item={0};uint8_t count=1;assert(esp_mqtt5_client_get_user_property(e->property->user_property,&item,&count)==ESP_OK&&count==1);assert(!strcmp(item.key,"source")&&!strcmp(item.value,"CLEX"));free((void*)item.key);free((void*)item.value);atomic_fetch_add(&o->properties,1);
        }
        pthread_mutex_lock(&o->lock); int n=atomic_load(&o->received); assert(n<64);assert(e->current_data_offset==0&&e->data_len==e->total_data_len);assert(e->topic_len<256&&e->data_len<256);
        memcpy(o->topics[n],e->topic,e->topic_len);o->topics[n][e->topic_len]=0;memcpy(o->payloads[n],e->data,e->data_len);o->payloads[n][e->data_len]=0;o->retained[n]=e->retain;
        atomic_store(&o->received,n+1);pthread_mutex_unlock(&o->lock);break;
    }default:break;
    }
}
static void init(observer *o){memset(o,0,sizeof(*o));pthread_mutex_init(&o->lock,0);}
static void wait_count(atomic_int *value,int count,const char *description){
    uint64_t end=platform_tick_get_ms()+9000;while(atomic_load(value)<count&&platform_tick_get_ms()<end)usleep(10000);
    if(atomic_load(value)<count){fprintf(stderr,"TIMEOUT %s: %d < %d\n",description,atomic_load(value),count);abort();}
}
static int seen(observer *o,const char *topic,const char *payload,int retain){
    int found=0;pthread_mutex_lock(&o->lock);for(int i=0;i<atomic_load(&o->received);i++)if(!strcmp(topic,o->topics[i])&&!strcmp(payload,o->payloads[i])&&(retain<0||o->retained[i]==retain))found=1;pthread_mutex_unlock(&o->lock);return found;
}
static void wait_seen(observer *o,const char *topic,const char *payload,int retain){uint64_t end=platform_tick_get_ms()+9000;while(!seen(o,topic,payload,retain)&&platform_tick_get_ms()<end)usleep(10000);if(!seen(o,topic,payload,retain)){fprintf(stderr,"Missing %s=%s\n",topic,payload);abort();}}
static esp_mqtt_client_handle_t client(observer *o,int port,int protocol,const char *name,int persistent,const char *ca,int will){
    esp_mqtt_client_config_t cfg={.broker.address.hostname="localhost",.broker.address.port=port,.broker.address.transport=ca?MQTT_TRANSPORT_OVER_SSL:MQTT_TRANSPORT_OVER_TCP,
        .broker.verification.certificate=ca,.credentials.client_id=name,.session.protocol_ver=protocol==5?MQTT_PROTOCOL_V_5:MQTT_PROTOCOL_V_3_1_1,
        .session.disable_clean_session=persistent,.session.keepalive=2,.network.reconnect_timeout_ms=250,.network.timeout_ms=1500,.network.disable_auto_reconnect=will,.buffer.size=1024};
    if(will){cfg.session.last_will.topic="suite/will";cfg.session.last_will.msg="offline";cfg.session.last_will.msg_len=7;cfg.session.last_will.qos=1;}
    esp_mqtt_client_handle_t c=esp_mqtt_client_init(&cfg);assert(c);
    if(protocol==5){esp_mqtt5_connection_property_config_t p={.session_expiry_interval=persistent?60:0};assert(esp_mqtt5_client_set_connect_property(c,&p)==ESP_OK);}
    assert(esp_mqtt_client_register_event(c,MQTT_EVENT_ANY,event,o)==ESP_OK);assert(esp_mqtt_client_start(c)==ESP_OK);return c;
}
static void destroy(esp_mqtt_client_handle_t c){assert(esp_mqtt_client_stop(c)==ESP_OK);usleep(20000);assert(esp_mqtt_client_destroy(c)==ESP_OK);}
static void subscribe(esp_mqtt_client_handle_t c,observer *o,const char *topic,int qos){int n=atomic_load(&o->subscribed);assert(esp_mqtt_client_subscribe(c,topic,qos)>0);wait_count(&o->subscribed,n+1,"subscribe");}
static void publish(esp_mqtt_client_handle_t c,observer *o,const char *topic,const char *payload,int qos,int retain){int n=atomic_load(&o->published);assert(esp_mqtt_client_publish(c,topic,payload,strlen(payload),qos,retain)>=0);if(qos)wait_count(&o->published,n+1,"publish ACK");}
static char *read_file(const char *path){FILE*f=fopen(path,"rb");assert(f);assert(!fseek(f,0,SEEK_END));long n=ftell(f);rewind(f);char*p=calloc(1,n+1);assert(fread(p,1,n,f)==(size_t)n);fclose(f);return p;}
static void basic(int port,int protocol){
    observer a,b,w;init(&a);init(&b);init(&w);
    esp_mqtt_client_handle_t c1=client(&a,port,protocol,"clex-suite-a",1,0,0),c2=client(&b,port,protocol,"clex-suite-b",0,0,0);
    wait_count(&a.connected,1,"client A connect");wait_count(&b.connected,1,"client B connect");
    subscribe(c1,&a,"suite/a/#",2);subscribe(c1,&a,"suite/+/value",1);subscribe(c1,&a,"other/#",1);
    for(int qos=0;qos<=2;qos++){char payload[32];snprintf(payload,sizeof(payload),"qos-%d",qos);publish(c2,&b,"suite/a/value",payload,qos,0);wait_seen(&a,"suite/a/value",payload,-1);}
    subscribe(c1,&a,"suite/binary",2);char binary[4]={0,(char)255,1,0};int ack=atomic_load(&b.published);assert(esp_mqtt_client_publish(c2,"suite/binary",binary,4,2,0)>0);wait_count(&b.published,ack+1,"binary ACK");wait_count(&a.binary,1,"binary payload");
    if(protocol==5){subscribe(c1,&a,"suite/properties",1);mqtt5_user_property_handle_t user=0;esp_mqtt5_user_property_item_t item={"source","CLEX"};assert(esp_mqtt5_client_set_user_property(&user,&item,1)==ESP_OK);char correlation[2]={0,(char)255};esp_mqtt5_publish_property_config_t p={.payload_format_indicator=true,.message_expiry_interval=60,.content_type="text/plain",.response_topic="reply/value",.correlation_data=correlation,.correlation_data_len=2,.user_property=user};assert(esp_mqtt5_client_set_publish_property(c2,&p)==ESP_OK);publish(c2,&b,"suite/properties","properties",1,0);wait_count(&a.properties,1,"MQTT5 properties");esp_mqtt5_client_delete_user_property(user);}
    publish(c2,&b,"other/value","second-subscription",1,0);wait_seen(&a,"other/value","second-subscription",-1);
    publish(c2,&b,"retained/value","snapshot",1,1);subscribe(c1,&a,"retained/#",1);wait_seen(&a,"retained/value","snapshot",1);
    int unsub=atomic_load(&a.unsubscribed);assert(esp_mqtt_client_unsubscribe(c1,"other/#")>0);wait_count(&a.unsubscribed,unsub+1,"unsubscribe");int received=atomic_load(&a.received);publish(c2,&b,"other/value","must-not-arrive",1,0);usleep(150000);assert(atomic_load(&a.received)==received);
    subscribe(c1,&a,"persistent/value",1);int disconnected=atomic_load(&a.disconnected);assert(esp_mqtt_client_disconnect(c1)==ESP_OK);wait_count(&a.disconnected,disconnected+1,"graceful disconnect");publish(c2,&b,"persistent/value","queued-offline",1,0);int connected=atomic_load(&a.connected);assert(esp_mqtt_client_reconnect(c1)==ESP_OK);wait_count(&a.connected,connected+1,"session reconnect");assert(atomic_load(&a.session)==1);wait_seen(&a,"persistent/value","queued-offline",-1);
    subscribe(c1,&a,"suite/will",1);esp_mqtt_client_handle_t cw=client(&w,port,protocol,"clex-suite-will",0,0,1);wait_count(&w.connected,1,"will client connect");host_transport_drop(esp_mqtt_client_get_transport(cw,"mqtt"));wait_seen(&a,"suite/will","offline",-1);destroy(cw);
    connected=atomic_load(&a.connected);int connected_b=atomic_load(&b.connected);puts("RESTART");fflush(stdout);assert(getchar()=='R');wait_count(&a.connected,connected+1,"broker loss/reconnect A");wait_count(&b.connected,connected_b+1,"broker loss/reconnect B");
    // The CLEX runtime owns subscription restoration; this engine test restores it explicitly.
    subscribe(c1,&a,"restored/#",2);publish(c2,&b,"restored/value","after-restart",2,0);wait_seen(&a,"restored/value","after-restart",-1);
    destroy(c2);destroy(c1);printf("PASS MQTT %s real broker: QoS 0/1/2, wildcard/multiple subscriptions, retain, unsubscribe, persistent session, LWT, two clients, loss/reconnect\n",protocol==5?"5.0":"3.1.1");
}
static void tls(int port,const char *ca_path,const char *bad_path){
    char *ca=read_file(ca_path),*bad=read_file(bad_path);observer o;init(&o);esp_mqtt_client_handle_t c=client(&o,port,5,"clex-tls-good",0,ca,0);wait_count(&o.connected,1,"verified TLS connect");subscribe(c,&o,"tls/#",1);publish(c,&o,"tls/value","verified",1,0);wait_seen(&o,"tls/value","verified",-1);destroy(c);
    observer wrong;init(&wrong);c=client(&wrong,port,5,"clex-tls-wrong-ca",0,bad,1);wait_count(&wrong.errors,1,"TLS untrusted CA error");assert(!atomic_load(&wrong.connected));destroy(c);
    observer name;init(&name);esp_mqtt_client_config_t cfg={.broker.address.hostname="localhost",.broker.address.port=port,.broker.address.transport=MQTT_TRANSPORT_OVER_SSL,.broker.verification.certificate=ca,.broker.verification.common_name="wrong.invalid",.credentials.client_id="clex-tls-wrong-host",.session.protocol_ver=MQTT_PROTOCOL_V_5,.network.disable_auto_reconnect=true,.network.timeout_ms=1500};c=esp_mqtt_client_init(&cfg);assert(c);assert(esp_mqtt_client_register_event(c,MQTT_EVENT_ANY,event,&name)==ESP_OK);assert(esp_mqtt_client_start(c)==ESP_OK);wait_count(&name.errors,1,"TLS hostname mismatch error");assert(!atomic_load(&name.connected));destroy(c);free(ca);free(bad);puts("PASS TLS verified connection, wrong CA rejection, hostname mismatch rejection");
}
static void auth(int port,int protocol){
    for(int good=1;good>=0;good--){observer o;init(&o);esp_mqtt_client_config_t cfg={.broker.address.hostname="localhost",.broker.address.port=port,.broker.address.transport=MQTT_TRANSPORT_OVER_TCP,.credentials.client_id="clex-auth",.credentials.username="clex-test",.credentials.authentication.password=good?"local-test-only":"incorrect",.session.protocol_ver=protocol==5?MQTT_PROTOCOL_V_5:MQTT_PROTOCOL_V_3_1_1,.network.disable_auto_reconnect=true,.network.timeout_ms=1500};esp_mqtt_client_handle_t c=esp_mqtt_client_init(&cfg);assert(c);assert(esp_mqtt_client_register_event(c,MQTT_EVENT_ANY,event,&o)==ESP_OK);assert(esp_mqtt_client_start(c)==ESP_OK);if(good){wait_count(&o.connected,1,"authenticated connection");subscribe(c,&o,"auth/#",1);publish(c,&o,"auth/value","authenticated",1,0);wait_seen(&o,"auth/value","authenticated",-1);}else{wait_count(&o.errors,1,"wrong password error");assert(!atomic_load(&o.connected));}destroy(c);}
    printf("PASS MQTT %s authentication and wrong-password error\n",protocol==5?"5.0":"3.1.1");
}
static void negative(int port){observer o;init(&o);esp_mqtt_client_handle_t c=client(&o,port,5,"clex-negative",0,0,0);wait_count(&o.connected,1,"negative test connect");esp_mqtt5_publish_property_config_t p={.payload_format_indicator=0,.payload_format_indicator_set=true,.message_expiry_interval=0,.message_expiry_interval_set=true};assert(esp_mqtt5_client_set_publish_property(c,&p)==ESP_OK);publish(c,&o,"negative/value","rejected",2,0);assert(atomic_load(&o.reason)==0x87);assert(esp_mqtt_client_get_outbox_size(c)==0);publish(c,&o,"negative/value","next-publish",2,0);assert(atomic_load(&o.reason)==0);assert(esp_mqtt_client_get_outbox_size(c)==0);destroy(c);puts("PASS MQTT 5 negative PUBREC reason, outbox/inflight cleanup, no PUBREL, explicit zero properties");}
int main(int argc,char **argv){signal(SIGPIPE,SIG_IGN);assert(argc>=3);if(!strcmp(argv[1],"basic")){assert(argc==4);basic(atoi(argv[2]),atoi(argv[3]));}else if(!strcmp(argv[1],"tls")){assert(argc==5);tls(atoi(argv[2]),argv[3],argv[4]);}else if(!strcmp(argv[1],"negative"))negative(atoi(argv[2]));else if(!strcmp(argv[1],"auth")){assert(argc==4);auth(atoi(argv[2]),atoi(argv[3]));}else abort();return 0;}
