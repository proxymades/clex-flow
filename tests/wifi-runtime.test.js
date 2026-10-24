import test from 'node:test';
import {runHostC} from './host-c.js';
import {WIFI_STATE} from '../src/firmware/drivers/esp-idf/wifi-runtime.js';

for(const automatic of [true,false])test('generated Wi-Fi controller handles asynchronous startup, retry, manual stop and timeouts; automatic retry '+automatic,()=>{
 let policy=WIFI_STATE;
 for(const [key,value]of Object.entries({AUTO_CONNECT:String(automatic),AUTO_RECONNECT:String(automatic),RETRY_US:'5000000',TIMEOUT_US:'30000000'}))policy=policy.replaceAll('@'+key+'@',value);
 runHostC(String.raw`
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <assert.h>
#define ESP_OK 0
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_TIMEOUT 0x107
#define ESP_ERR_WIFI_NOT_STARTED 0x3002
#define ESP_ERR_WIFI_CONN 0x3007
typedef int esp_err_t;
static unsigned starts,stops,connects,failures,changes;
static int state,last_reason,start_error,stop_error,connect_error;
static const char*last_context;
static esp_err_t esp_wifi_start(void){starts++;return start_error;}
static esp_err_t esp_wifi_stop(void){stops++;return stop_error;}
static esp_err_t esp_wifi_connect(void){connects++;return connect_error;}
static void clex_wifi_status(int next){state=next;}
static void clex_wifi_failure(int reason,const char*context){state=4;last_reason=reason;last_context=context;failures++;}
static void clex_wifi_changed(void){changes++;}
`+policy+String.raw`
static void reset(void){memset(&clex_wifi_control,0,sizeof(clex_wifi_control));starts=stops=connects=failures=changes=0;state=last_reason=start_error=stop_error=connect_error=0;last_context="";}
int main(void){
 // Boot waits for the SDK's STA_START event before the first connect.
 clex_wifi_step(0,0,0);assert(starts==@AUTO@&&connects==0);
 reset();clex_wifi_step(WF_CONNECT,0,0);assert(starts==1&&connects==0);
 clex_wifi_step(0,0,500000);assert(connects==0);
 clex_wifi_step(WF_STARTED,0,1000000);assert(connects==1&&state==1);
 // Polling cannot issue a second connect while the original attempt is active.
 for(int64_t now=2000000;now<10000000;now+=1000000)clex_wifi_step(0,0,now);
 assert(connects==1&&failures==0);
 clex_wifi_step(WF_ASSOCIATED,0,10000000);assert(state==2&&clex_wifi_control.linked);
 clex_wifi_step(WF_IP,0,11000000);assert(state==3&&clex_wifi_control.deadline==0);
 clex_wifi_step(0,0,50000000);assert(connects==1&&failures==0);
 // Disconnect reason is kept and retry obeys the configured delay.
 clex_wifi_step(WF_LOST,201,51000000);assert(state==4&&last_reason==201);
 clex_wifi_step(0,0,55999999);assert(connects==1);
 clex_wifi_step(0,0,56000000);assert(connects==1+@AUTO@);
 // Manual stop waits for STA_STOP before restarting, even with a queued connect.
 clex_wifi_step(WF_DISCONNECT,0,57000000);assert(state==0&&stops==1&&!clex_wifi_control.wanted);
 unsigned before=connects;clex_wifi_step(WF_CONNECT,0,58000000);assert(starts==1&&connects==before);
 clex_wifi_step(WF_LOST,8,59000000);assert(stops==1&&failures==1);
 clex_wifi_step(WF_STOPPED,0,60000000);assert(starts==2&&connects==before);
 clex_wifi_step(WF_STARTED,0,61000000);assert(connects==before+1);
 // Late IP events after a manual stop cannot bring the connection online.
 clex_wifi_step(WF_DISCONNECT,0,62000000);clex_wifi_step(WF_IP,0,63000000);assert(state==0);
 // A missing SDK response is bounded by the timeout and is cancelled once.
 reset();clex_wifi_step(WF_CONNECT,0,0);clex_wifi_step(WF_STARTED,0,1);
 clex_wifi_step(0,0,30000001);assert(stops==1&&last_reason==ESP_ERR_TIMEOUT&&state==4);
 clex_wifi_step(0,0,31000000);assert(stops==1&&connects==1);
 clex_wifi_step(WF_STOPPED,0,32000000);assert(starts==1);
 clex_wifi_step(0,0,35000001);assert(starts==1+@AUTO@);
 // DHCP acquisition has a separate deadline after association.
 reset();clex_wifi_step(WF_CONNECT,0,0);clex_wifi_step(WF_STARTED,0,1);clex_wifi_step(WF_ASSOCIATED,0,2000000);
 clex_wifi_step(0,0,32000000);assert(last_reason==ESP_ERR_TIMEOUT&&!strcmp(last_context,"Wi-Fi DHCP timeout"));
 // SDK errors stay visible and never cause a tight reconnect loop.
 reset();start_error=0x123;clex_wifi_step(WF_CONNECT,0,0);assert(starts==1&&failures==1&&last_reason==0x123);
 clex_wifi_step(0,0,4999999);assert(starts==1);
 clex_wifi_step(0,0,5000000);assert(starts==1+@AUTO@);
 reset();connect_error=0x124;clex_wifi_step(WF_CONNECT,0,0);clex_wifi_step(WF_STARTED,0,1);assert(failures==1&&last_reason==0x124);
 clex_wifi_step(0,0,2);assert(connects==1);
 // The driver's already-connecting response waits for completion or timeout.
 reset();connect_error=ESP_ERR_WIFI_CONN;clex_wifi_step(WF_CONNECT,0,0);clex_wifi_step(WF_STARTED,0,1);clex_wifi_step(0,0,5000000);assert(connects==1&&failures==0);
 // Lost DHCP, explicit reconnect and queue overflow all use the same lifecycle.
 reset();clex_wifi_step(WF_CONNECT,0,0);clex_wifi_step(WF_STARTED,0,1);clex_wifi_step(WF_ASSOCIATED,0,2);clex_wifi_step(WF_IP,0,3);
 clex_wifi_step(WF_LOST_IP,0,4);assert(state==2&&clex_wifi_control.linked&&connects==1);
 clex_wifi_step(WF_STATUS,0,5);assert(changes==1);
 clex_wifi_step(WF_RECONNECT,0,6);assert(stops==1&&clex_wifi_control.wanted);
 clex_wifi_step(WF_STOPPED,0,7);clex_wifi_step(WF_STARTED,0,8);assert(starts==2&&connects==2);
 clex_wifi_step(WF_OVERFLOW,0,9);assert(last_reason==ESP_ERR_NO_MEM&&stops==2);
 return 0;
}
`.replaceAll('@AUTO@',automatic?'1':'0'),'clex-wifi-policy-');
});
