import process from 'node:process';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {compileHost} from './build.mjs';
import {mqttFirmware} from '../../src/firmware/drivers/mqtt.js';
import {catalog} from '../catalog-fixture.js';
const sdk=process.env.CLEX_TEST_IDF_ROOT||process.env.IDF_PATH;if(!sdk)throw Error('Set CLEX_TEST_IDF_ROOT to local ESP-IDF 5.4.4.');
const broker=process.env.CLEX_TEST_MOSQUITTO||resolve('.artifacts/mqtt/deps/build/src/mosquitto');if(!existsSync(broker))throw Error('Set CLEX_TEST_MOSQUITTO to a local Mosquitto binary.');
const root=resolve('.artifacts/mqtt/pressure-runtime');mkdirSync(root,{recursive:true});
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
const defaults=id=>Object.fromEntries(Object.entries(catalog.modules.find(m=>m.id===id).parameters).map(([key,p])=>[key,p.default]));
const project={id:'tls-runtime',boardId:'waveshare-esp32-s3-eth',components:[{id:'ethernet',moduleId:'clex.hardware.ethernet',parameters:{...defaults('clex.hardware.ethernet'),providerId:catalog.boards.find(b=>b.id==='waveshare-esp32-s3-eth').networkInterfaces[0].id}}]};
const protocol=process.argv.includes('--311')?'3.1.1':'5.0';
project.components.push({id:'mqtt',moduleId:'clex.hardware.mqtt',parameters:{...defaults('clex.hardware.mqtt'),host:'localhost',port,protocol,networkId:'ethernet',timeoutMs:1000,reconnectMs:1000}});
const nodes=Array.from({length:4},(_,i)=>({id:'receive'+i,moduleId:'clex.logic.mqtt-receive',parameters:{...defaults('clex.logic.mqtt-receive'),componentId:'mqtt',filters:JSON.stringify([{topic:'pressure/'+i,qos:1}]),payloadEncoding:'hex'}}));nodes.push({id:'send',moduleId:'clex.logic.mqtt-send',parameters:{...defaults('clex.logic.mqtt-send'),componentId:'mqtt',topic:'pressure/0',payload:'00',qos:'1',payloadEncoding:'hex'}});project.logic={nodes,edges:[]};
const runtime=mqttFirmware(project,catalog,nodes,new Map(nodes.map((n,i)=>[n.id,i])),v=>JSON.stringify(String(v)));
const main=join(root,'runtime.c');writeFileSync(main,readFileSync('tests/mqtt-host/runtime-support.h','utf8')+'\n'+runtime.source+String.raw`
static pthread_t graph_thread;static unsigned connected,received[4],sent,subscribed,attempts,send_failed;
static void clex_mq_notify(unsigned kind,unsigned slot,unsigned node){(void)slot;assert(pthread_equal(graph_thread,pthread_self()));if(kind==MQ_CONNECTED)connected++;if(kind==MQ_RECEIVED){assert(node<4);received[node]++;}if(kind==MQ_SENT)sent++;if(kind==MQ_SEND_FAILED)send_failed++;if(kind==MQ_SUBSCRIBED)subscribed++;}
static void pump(unsigned ms){uint64_t end=platform_tick_get_ms()+ms;do{clex_mq_poll();assert(atomic_load(&mq_memory)<=MQ_MEMORY_LIMIT);usleep(5000);}while(platform_tick_get_ms()<end);}
static void send_value(unsigned owner,unsigned pattern){static const char digits[]="0123456789abcdef";char text[8193],topic[32];for(unsigned i=0;i<4096;i++){text[i*2]=digits[(pattern>>4)&15];text[i*2+1]=digits[pattern&15];}text[8192]=0;snprintf(topic,sizeof(topic),"pressure/%u",owner);unsigned before=received[owner];clex_mq_send(0,topic,text);attempts++;uint64_t end=platform_tick_get_ms()+5000;while(received[owner]==before&&platform_tick_get_ms()<end)pump(5);if(received[owner]==before)fprintf(stderr,"Pressure stalled owner%u used=%u clienterror=%s ownererror=%s\n",owner,atomic_load(&mq_memory),mq_clients[0].error,mq_owners[owner].value.error);assert(received[owner]>before);assert(!strcmp(mq_owners[owner].value.payload,text));}
int main(void){signal(SIGPIPE,SIG_IGN);graph_thread=pthread_self();clex_mq_initialize();uint64_t end=platform_tick_get_ms()+10000;while((!connected||subscribed<4)&&platform_tick_get_ms()<end)pump(5);assert(connected&&subscribed==4);for(unsigned i=0;i<4;i++)send_value(i,0xa0+i);for(unsigned i=0;i<8;i++)send_value(i%4,0xd0+i);end=platform_tick_get_ms()+5000;while(sent<attempts&&platform_tick_get_ms()<end)pump(5);assert(sent==attempts&&send_failed==0);
// Force an actual resource shortage independently of the metadata builder.
void *reserve=mq_alloc(14000);assert(reserve);uint8_t incoming[4096];memset(incoming,0x11,sizeof(incoming));assert(esp_mqtt_client_publish(mq_clients[0].handle,"pressure/0",(const char*)incoming,sizeof(incoming),0,0)>=0);pump(300);assert(strstr(mq_owners[0].value.error,"memory pressure"));mq_free(reserve);send_value(0,0xee);assert(atomic_load(&mq_memory)<=MQ_MEMORY_LIMIT);
clex_mq_disconnect(0);pump(150);printf("PASS generated CLEX MQTT %s receive-pool pressure: four independent 4096-byte hex views, repeated replacements, 64KiB cap, continued delivery\n",mq_configs[0].v5?"5.0":"3.1.1");return 0;}

`);
writeFileSync(join(root,'mbedtls-test-config.h'),'#define MBEDTLS_BASE64_C\n');const mbed=join(sdk,'components/mbedtls/mbedtls'),json=join(sdk,'components/json/cJSON');const exe=compileHost(main,{output:'mqtt-pressure-runtime',extra:['-I'+join(mbed,'include'),'-I'+join(mbed,'library'),'-I'+json,'-DMBEDTLS_CONFIG_FILE="'+join(root,'mbedtls-test-config.h')+'"',join(mbed,'library/base64.c'),join(mbed,'library/constant_time.c'),join(mbed,'library/platform_util.c'),join(json,'cJSON.c')]});
const config=join(root,'broker.conf');writeFileSync(config,`listener ${port} 127.0.0.1\nallow_anonymous true\n`);
let b,client;async function stop(p){if(p&&p.exitCode===null&&p.signalCode===null){p.kill('SIGTERM');await Promise.race([once(p,'exit'),new Promise(r=>setTimeout(()=>{p.kill('SIGKILL');r();},2000))]);}}
try{b=spawn(broker,['-c',config],{stdio:'ignore'});let ready=false;for(let i=0;i<100;i++){try{await new Promise((resolve,reject)=>{const socket=net.connect(port,'127.0.0.1');socket.once('connect',()=>{socket.end();resolve();});socket.once('error',reject);});ready=true;break;}catch{await new Promise(r=>setTimeout(r,20));}}if(!ready)throw Error('Pressure broker failed to start');client=spawn(exe,[],{stdio:['ignore','pipe','pipe']});let out='',err='';client.stdout.on('data',d=>out+=d);client.stderr.on('data',d=>err+=d);const timer=setTimeout(()=>client.kill('SIGKILL'),45000);const[code,signal]=await once(client,'exit');clearTimeout(timer);if(code!==0)throw Error(`Pressure generated runtime exited ${code}/${signal}\n${err}`);console.log(out.trim());}finally{await stop(client);await stop(b);}
