// Connection policy is shared by the generated driver and host runtime checks.
export const WIFI_STATE=String.raw`
enum { WF_STATUS=1,WF_CONNECT,WF_DISCONNECT,WF_RECONNECT,WF_STARTED,WF_STOPPED,WF_ASSOCIATED,WF_LOST,WF_IP,WF_LOST_IP,WF_OVERFLOW };
static struct {bool wanted,started,ready,stopping,connecting,linked;int64_t due,deadline;} clex_wifi_control={.wanted=@AUTO_CONNECT@};
static void clex_wifi_stop_driver(void){
 if(!clex_wifi_control.started||clex_wifi_control.stopping)return;
 clex_wifi_control.stopping=true;
 clex_wifi_control.ready=clex_wifi_control.connecting=clex_wifi_control.linked=false;
 esp_err_t error=esp_wifi_stop();
 if(error!=ESP_OK){
  clex_wifi_control.started=clex_wifi_control.stopping=false;
  if(error!=ESP_ERR_WIFI_NOT_STARTED){clex_wifi_control.wanted=false;clex_wifi_failure(error,"Wi-Fi stop");}
 }
}
static void clex_wifi_step(unsigned event,int reason,int64_t now){
 switch(event){
 case WF_STATUS:clex_wifi_changed();break;
 case WF_CONNECT:if(!clex_wifi_control.wanted){clex_wifi_control.wanted=true;clex_wifi_control.due=now;}break;
 case WF_DISCONNECT:clex_wifi_control.wanted=false;clex_wifi_stop_driver();clex_wifi_status(0);break;
 case WF_RECONNECT:clex_wifi_control.wanted=true;clex_wifi_control.due=now;clex_wifi_stop_driver();clex_wifi_status(1);break;
 case WF_STARTED:clex_wifi_control.ready=true;if(clex_wifi_control.wanted&&!clex_wifi_control.stopping)clex_wifi_status(1);break;
 case WF_STOPPED:clex_wifi_control.started=clex_wifi_control.ready=clex_wifi_control.stopping=clex_wifi_control.connecting=clex_wifi_control.linked=false;break;
 case WF_ASSOCIATED:if(clex_wifi_control.wanted&&!clex_wifi_control.stopping){clex_wifi_control.connecting=false;clex_wifi_control.linked=true;clex_wifi_control.deadline=now+@TIMEOUT_US@LL;clex_wifi_status(2);}break;
 case WF_IP:if(clex_wifi_control.wanted&&!clex_wifi_control.stopping&&clex_wifi_control.linked){clex_wifi_control.deadline=0;clex_wifi_status(3);}break;
 case WF_LOST:
  if(!clex_wifi_control.started||clex_wifi_control.stopping||!clex_wifi_control.wanted)break;
  clex_wifi_control.connecting=clex_wifi_control.linked=false;clex_wifi_control.deadline=0;
  clex_wifi_failure(reason,"Wi-Fi disconnected");clex_wifi_control.due=now+@RETRY_US@LL;
  if(!@AUTO_RECONNECT@)clex_wifi_control.wanted=false;
  break;
 case WF_LOST_IP:if(clex_wifi_control.linked&&!clex_wifi_control.stopping&&clex_wifi_control.wanted){clex_wifi_control.deadline=now+@TIMEOUT_US@LL;clex_wifi_status(2);}break;
 case WF_OVERFLOW:
  clex_wifi_failure(ESP_ERR_NO_MEM,"Wi-Fi event queue");clex_wifi_control.wanted=@AUTO_RECONNECT@;clex_wifi_control.due=now+@RETRY_US@LL;clex_wifi_control.stopping=false;clex_wifi_stop_driver();break;
 default:break;
 }
 if(!clex_wifi_control.wanted||clex_wifi_control.stopping)return;
 if(!clex_wifi_control.started){
  if(now<clex_wifi_control.due)return;
  clex_wifi_control.started=true;clex_wifi_control.deadline=now+@TIMEOUT_US@LL;clex_wifi_status(1);
  esp_err_t error=esp_wifi_start();
  if(error!=ESP_OK){clex_wifi_control.started=false;clex_wifi_failure(error,"Wi-Fi start");clex_wifi_control.due=now+@RETRY_US@LL;if(!@AUTO_RECONNECT@)clex_wifi_control.wanted=false;}
  return;
 }
 if(clex_wifi_control.deadline&&now>=clex_wifi_control.deadline){
  clex_wifi_failure(ESP_ERR_TIMEOUT,clex_wifi_control.linked?"Wi-Fi DHCP timeout":"Wi-Fi connection timeout");
  clex_wifi_control.wanted=@AUTO_RECONNECT@;clex_wifi_control.due=now+@RETRY_US@LL;clex_wifi_stop_driver();return;
 }
 if(!clex_wifi_control.ready||clex_wifi_control.connecting||clex_wifi_control.linked||now<clex_wifi_control.due)return;
 clex_wifi_control.connecting=true;clex_wifi_control.deadline=now+@TIMEOUT_US@LL;clex_wifi_status(1);
 esp_err_t error=esp_wifi_connect();
 if(error!=ESP_OK&&error!=ESP_ERR_WIFI_CONN){
  clex_wifi_control.connecting=false;clex_wifi_control.deadline=0;clex_wifi_failure(error,"Wi-Fi connect");clex_wifi_control.due=now+@RETRY_US@LL;if(!@AUTO_RECONNECT@)clex_wifi_control.wanted=false;
 }
}
`;

export const WIFI_RUNTIME=String.raw`
enum { WF_CHANGED=1,WF_CONNECTED=2,WF_DISCONNECTED=4,WF_IP_CHANGED=8,WF_FAILED=16 };
typedef struct {bool connected;int state,reason;char ip[16],netmask[16],gateway[16],dns[48],error[128];} clex_wifi_snapshot_t;
typedef struct {unsigned kind;int reason;esp_netif_ip_info_t info;} clex_wifi_event_t;
static esp_netif_t*clex_wifi_netif;
static QueueHandle_t clex_wifi_queue;
static SemaphoreHandle_t clex_wifi_mutex;
static atomic_bool clex_wifi_overflow,clex_wifi_task_ready;
static clex_wifi_snapshot_t clex_wifi_value;
static unsigned clex_wifi_events;
static void clex_wifi_notify(unsigned flags,clex_wifi_snapshot_t value);
static void clex_wifi_changed(void){xSemaphoreTake(clex_wifi_mutex,portMAX_DELAY);clex_wifi_events|=WF_CHANGED;xSemaphoreGive(clex_wifi_mutex);}
static const char*clex_wifi_reason(int reason){
 switch(reason){
 case WIFI_REASON_NO_AP_FOUND:return "NO_AP_FOUND";
 case WIFI_REASON_AUTH_FAIL:return "AUTH_FAIL";
 case WIFI_REASON_ASSOC_FAIL:return "ASSOC_FAIL";
 case WIFI_REASON_HANDSHAKE_TIMEOUT:return "HANDSHAKE_TIMEOUT";
 case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:return "4WAY_HANDSHAKE_TIMEOUT";
 case WIFI_REASON_BEACON_TIMEOUT:return "BEACON_TIMEOUT";
 case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:return "NO_AP_FOUND_W_COMPATIBLE_SECURITY";
 case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:return "NO_AP_FOUND_IN_AUTHMODE_THRESHOLD";
 case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD:return "NO_AP_FOUND_IN_RSSI_THRESHOLD";
 default:return "UNKNOWN";
 }
}
static void clex_wifi_status(int state){
 xSemaphoreTake(clex_wifi_mutex,portMAX_DELAY);
 bool before=clex_wifi_value.connected;
 clex_wifi_value.state=state;clex_wifi_value.connected=state==3;
 unsigned flags=WF_CHANGED;
 if(state!=3){
  if(clex_wifi_value.ip[0])flags|=WF_IP_CHANGED;
  clex_wifi_value.ip[0]=clex_wifi_value.netmask[0]=clex_wifi_value.gateway[0]=clex_wifi_value.dns[0]=0;
 }
 if(state==0||state==3){clex_wifi_value.error[0]=0;clex_wifi_value.reason=0;}
 if(before!=clex_wifi_value.connected)flags|=clex_wifi_value.connected?WF_CONNECTED:WF_DISCONNECTED;
 clex_wifi_events|=flags;xSemaphoreGive(clex_wifi_mutex);
 if(before!=(state==3)){@NETWORK_CHANGED@}
}
static void clex_wifi_failure(int reason,const char*context){
 clex_wifi_status(4);
 xSemaphoreTake(clex_wifi_mutex,portMAX_DELAY);
 clex_wifi_value.reason=reason;
 const char*name=reason>0&&reason<256?clex_wifi_reason(reason):esp_err_to_name(reason);
 snprintf(clex_wifi_value.error,sizeof(clex_wifi_value.error),"%s: %d (%s)",context,reason,name);
 clex_wifi_events|=WF_FAILED|WF_CHANGED;
 ESP_LOGW("CLEX_WIFI","%s",clex_wifi_value.error);
 xSemaphoreGive(clex_wifi_mutex);
}
`+WIFI_STATE+String.raw`
static void clex_wifi_event(void*argument,esp_event_base_t base,int32_t id,void*data){
 (void)argument;clex_wifi_event_t event={0};
 if(base==WIFI_EVENT){
  switch(id){
  case WIFI_EVENT_STA_START:event.kind=WF_STARTED;break;
  case WIFI_EVENT_STA_STOP:event.kind=WF_STOPPED;break;
  case WIFI_EVENT_STA_CONNECTED:event.kind=WF_ASSOCIATED;break;
  case WIFI_EVENT_STA_DISCONNECTED:event.kind=WF_LOST;event.reason=data?((wifi_event_sta_disconnected_t*)data)->reason:0;break;
  default:return;
  }
 }else if(base==IP_EVENT){
  if(id==IP_EVENT_STA_GOT_IP&&data&&((ip_event_got_ip_t*)data)->esp_netif==clex_wifi_netif){event.kind=WF_IP;event.info=((ip_event_got_ip_t*)data)->ip_info;}
  else if(id==IP_EVENT_STA_LOST_IP)event.kind=WF_LOST_IP;
  else return;
 }else return;
 if(xQueueSend(clex_wifi_queue,&event,0)!=pdTRUE)atomic_store(&clex_wifi_overflow,true);
}
static void clex_wifi_addresses(const esp_netif_ip_info_t*info){
 esp_netif_dns_info_t dns={0};esp_netif_get_dns_info(clex_wifi_netif,ESP_NETIF_DNS_MAIN,&dns);
 char ip[16],netmask[16],gateway[16],dns_text[48]="";
 esp_ip4addr_ntoa(&info->ip,ip,sizeof(ip));esp_ip4addr_ntoa(&info->netmask,netmask,sizeof(netmask));esp_ip4addr_ntoa(&info->gw,gateway,sizeof(gateway));
 if(dns.ip.type==ESP_IPADDR_TYPE_V4)esp_ip4addr_ntoa(&dns.ip.u_addr.ip4,dns_text,sizeof(dns_text));
 xSemaphoreTake(clex_wifi_mutex,portMAX_DELAY);
 bool changed=strcmp(ip,clex_wifi_value.ip)||strcmp(netmask,clex_wifi_value.netmask)||strcmp(gateway,clex_wifi_value.gateway)||strcmp(dns_text,clex_wifi_value.dns);
 strlcpy(clex_wifi_value.ip,ip,sizeof(clex_wifi_value.ip));
 strlcpy(clex_wifi_value.netmask,netmask,sizeof(clex_wifi_value.netmask));
 strlcpy(clex_wifi_value.gateway,gateway,sizeof(clex_wifi_value.gateway));
 strlcpy(clex_wifi_value.dns,dns_text,sizeof(clex_wifi_value.dns));
 if(changed)clex_wifi_events|=WF_IP_CHANGED|WF_CHANGED;
 xSemaphoreGive(clex_wifi_mutex);
 if(changed){@NETWORK_CHANGED@}
 ESP_LOGI("CLEX_WIFI","IPv4 acquired: %s",ip);
}
static void clex_wifi_task(void*argument){
 (void)argument;clex_wifi_event_t event;
 for(;;){
  bool received=xQueueReceive(clex_wifi_queue,&event,pdMS_TO_TICKS(100))==pdTRUE;
  if(atomic_exchange(&clex_wifi_overflow,false))clex_wifi_step(WF_OVERFLOW,0,esp_timer_get_time());
  if(received){
   if(event.kind==WF_IP){
    if(!clex_wifi_control.wanted||clex_wifi_control.stopping||!clex_wifi_control.linked||!event.info.ip.addr)continue;
    clex_wifi_addresses(&event.info);
   }
   clex_wifi_step(event.kind,event.reason,esp_timer_get_time());
  }else clex_wifi_step(0,0,esp_timer_get_time());
 }
}
static void __attribute__((unused)) clex_wifi_request(unsigned kind){
 if(!atomic_load(&clex_wifi_task_ready))return;
 clex_wifi_event_t event={.kind=kind};
 if(xQueueSend(clex_wifi_queue,&event,0)!=pdTRUE)atomic_store(&clex_wifi_overflow,true);
}
static void clex_wifi_poll(void){
 if(!clex_wifi_mutex)return;
 xSemaphoreTake(clex_wifi_mutex,portMAX_DELAY);
 unsigned flags=clex_wifi_events;clex_wifi_snapshot_t value=clex_wifi_value;clex_wifi_events=0;
 xSemaphoreGive(clex_wifi_mutex);
 // Clock startup shares flow_worker with MQTT and cannot race its TLS clock check.
 if(flags&&value.connected&&!esp_sntp_enabled()){esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);esp_sntp_setservername(0,"pool.ntp.org");esp_sntp_init();}
 if(flags)clex_wifi_notify(flags,value);
}
static void clex_wifi_initialize(void){
 clex_wifi_mutex=xSemaphoreCreateMutex();clex_wifi_queue=xQueueCreate(24,sizeof(clex_wifi_event_t));
 if(!clex_wifi_mutex||!clex_wifi_queue){if(clex_wifi_mutex)clex_wifi_failure(ESP_ERR_NO_MEM,"Wi-Fi controller allocation");else ESP_LOGE("CLEX_WIFI","Cannot allocate Wi-Fi controller");return;}
 esp_err_t error=nvs_flash_init();if(error!=ESP_OK)goto failure;
 error=esp_netif_init();if(error!=ESP_OK)goto failure;
 error=esp_event_loop_create_default();if(error!=ESP_OK&&error!=ESP_ERR_INVALID_STATE)goto failure;
 clex_wifi_netif=esp_netif_create_default_wifi_sta();if(!clex_wifi_netif){error=ESP_ERR_NO_MEM;goto failure;}
 wifi_init_config_t initialization=WIFI_INIT_CONFIG_DEFAULT();
 error=esp_wifi_init(&initialization);if(error!=ESP_OK)goto failure;
 error=esp_wifi_set_storage(WIFI_STORAGE_RAM);if(error!=ESP_OK)goto failure;
 error=esp_wifi_set_mode(WIFI_MODE_STA);if(error!=ESP_OK)goto failure;
 wifi_config_t config={0};
 memcpy(config.sta.ssid,@SSID@,@SSID_BYTES@);
 memcpy(config.sta.password,@PASSWORD@,@PASSWORD_BYTES@);
 config.sta.threshold.authmode=@AUTH_MODE@;
 config.sta.pmf_cfg.capable=true;
 config.sta.sae_pwe_h2e=WPA3_SAE_PWE_BOTH;
 error=esp_wifi_set_config(WIFI_IF_STA,&config);if(error!=ESP_OK)goto failure;
 @STATIC_IP@
 error=esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,clex_wifi_event,NULL);if(error!=ESP_OK)goto failure;
 error=esp_event_handler_register(IP_EVENT,ESP_EVENT_ANY_ID,clex_wifi_event,NULL);if(error!=ESP_OK)goto failure;
 atomic_store(&clex_wifi_task_ready,true);
 if(xTaskCreate(clex_wifi_task,"clex_wifi",4096,NULL,4,NULL)!=pdPASS){atomic_store(&clex_wifi_task_ready,false);error=ESP_ERR_NO_MEM;goto failure;}
 ESP_LOGI("CLEX_WIFI","Station initialized; automatic connection: %s",@AUTO_CONNECT@?"enabled":"disabled");
 return;
 failure:clex_wifi_failure(error,"Wi-Fi initialization");
}
`;
