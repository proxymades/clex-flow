import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
export function compileHost(main,{output='mqtt-host',extra=[]}={}){
 const sdk=process.env.CLEX_TEST_IDF_ROOT||process.env.IDF_PATH;
 if(!sdk)throw Error('Set CLEX_TEST_IDF_ROOT to installed ESP-IDF 5.4.4; this check downloads nothing.');
 const mqtt=process.env.CLEX_TEST_MQTT_ROOT||resolve('src/firmware/components/mqtt');
 const root=resolve('.artifacts/mqtt/host');mkdirSync(join(root,'include/freertos'),{recursive:true});
 for(const name of ['esp_err.h','esp_log.h','esp_heap_caps.h','esp_event.h','esp_tls.h','esp_idf_version.h','esp_timer.h','freertos/FreeRTOS.h','freertos/semphr.h','freertos/task.h','freertos/event_groups.h','freertos/queue.h'])writeFileSync(join(root,'include',name),'#include "'+resolve('tests/mqtt-host/host.h')+'"\n');
 writeFileSync(join(root,'include/sdkconfig.h'),'#define CONFIG_MQTT_PROTOCOL_311 1\n#define CONFIG_MQTT_PROTOCOL_5 1\n#define CONFIG_MQTT_TRANSPORT_SSL 1\n#define CONFIG_MQTT_TRANSPORT_WEBSOCKET 0\n#define CONFIG_MQTT_TRANSPORT_WEBSOCKET_SECURE 0\n#define CONFIG_MQTT_MSG_ID_INCREMENTAL 1\n#define CONFIG_MQTT_SKIP_PUBLISH_IF_DISCONNECTED 0\n#define CONFIG_MQTT_REPORT_DELETED_MESSAGES 1\n#define CONFIG_MQTT_POLL_READ_TIMEOUT_MS 25\n#define CONFIG_MQTT_TASK_CORE_SELECTION_ENABLED 0\n#define CONFIG_MQTT_EVENT_QUEUE_SIZE 1\n');
 const sources=['mqtt_client.c','mqtt5_client.c','lib/mqtt_msg.c','lib/mqtt5_msg.c','lib/mqtt_outbox.c'].map(p=>join(mqtt,p));
 if(existsSync(join(mqtt,'lib/mqtt_utils/mqtt_utils.c')))sources.push(join(mqtt,'lib/mqtt_utils/mqtt_utils.c'));
 const includes=[join(mqtt,'lib/mqtt_utils/include'),join(root,'include'),resolve('tests/mqtt-host'),join(mqtt,'include'),join(mqtt,'lib/include'),join(sdk,'components/tcp_transport/include'),join(sdk,'components/http_parser')];
 if(!existsSync(join(mqtt,'mqtt_client.c')))throw Error('ESP-MQTT source not found: '+mqtt);
 const target=join(root,output),ssl=process.env.CLEX_TEST_OPENSSL_ROOT||'/opt/homebrew/opt/openssl@3';
 const args=['-std=gnu11','-g','-O1','-pthread','-DESP_PLATFORM=1','-include',join(root,'include/sdkconfig.h'),'-include',resolve('tests/mqtt-host/host.h'),...includes.flatMap(p=>['-I',p]),'-I'+join(ssl,'include'),...sources,join(sdk,'components/http_parser/http_parser.c'),resolve('tests/mqtt-host/host.c'),main,...extra,'-L'+join(ssl,'lib'),'-Wl,-rpath,'+join(ssl,'lib'),'-lssl','-lcrypto','-o',target];
 const result=spawnSync(process.env.CC||'cc',args,{encoding:'utf8'});if(result.status!==0)throw Error(result.stdout+result.stderr);
 return target;
}
