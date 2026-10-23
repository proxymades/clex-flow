import process from 'node:process';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import net from 'node:net';
import {compileHost} from './build.mjs';
import {mqttFirmware} from '../../src/firmware/drivers/mqtt.js';
import {catalog} from '../catalog-fixture.js';
const sdk=process.env.CLEX_TEST_IDF_ROOT||process.env.IDF_PATH;if(!sdk)throw Error('Set CLEX_TEST_IDF_ROOT to local ESP-IDF 5.4.4.');
const broker=process.env.CLEX_TEST_MOSQUITTO||resolve('.artifacts/mqtt/deps/build/src/mosquitto');if(!existsSync(broker))throw Error('Set CLEX_TEST_MOSQUITTO to a local Mosquitto binary.');
const root=resolve('.artifacts/mqtt/runtime');mkdirSync(root,{recursive:true});
const portServer=net.createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const sockets=new Set();const proxy=net.createServer(downstream=>{const upstream=net.connect(port,'127.0.0.1');sockets.add(downstream);sockets.add(upstream);let first=true;downstream.on('data',d=>upstream.write(d));upstream.on('data',d=>{if(first){first=false;setTimeout(()=>{if(!downstream.destroyed)downstream.write(d);},500);}else downstream.write(d);});for(const [a,b]of[[downstream,upstream],[upstream,downstream]]){a.on('error',()=>b.destroy());a.on('close',()=>{sockets.delete(a);b.destroy();});}});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const moduleDefaults=id=>Object.fromEntries(Object.entries(catalog.modules.find(m=>m.id===id).parameters).map(([key,p])=>[key,p.default]));
const defaults={...moduleDefaults('clex.hardware.mqtt'),host:'localhost',port,protocol:'3.1.1',clientId:'',networkId:'ethernet',keepAlive:2,cleanSession:true,sessionExpiry:0,autoConnect:true,autoReconnect:true,reconnectMs:1000,timeoutMs:1500};
const project={id:'host-runtime',boardId:'waveshare-esp32-s3-eth',components:[['mqtt-a','3.1.1',true],['mqtt-b','5.0',false],['mqtt-c','5.0',false]].map(([id,protocol,autoConnect])=>({id,moduleId:'clex.hardware.mqtt',parameters:{...defaults,protocol,autoConnect}}))};
project.components.unshift({id:'ethernet',moduleId:'clex.hardware.ethernet',parameters:{...moduleDefaults('clex.hardware.ethernet'),providerId:catalog.boards.find(b=>b.id===project.boardId).networkInterfaces[0].id}});
project.components.push({id:'router',moduleId:'clex.hardware.router',parameters:moduleDefaults('clex.hardware.router')});
Object.assign(project.components.find(c=>c.id==='mqtt-c').parameters,{networkId:'router',port:proxy.address().port});
const receive=(id,componentId,filters,payloadEncoding='utf8')=>({id,moduleId:'clex.logic.mqtt-receive',parameters:{...moduleDefaults('clex.logic.mqtt-receive'),componentId,filters:JSON.stringify(filters),payloadEncoding,autoSubscribe:true,noLocal:false,retainAsPublished:false,retainHandling:'0'}});
const send=(id,componentId,qos,encoding='utf8')=>({id,moduleId:'clex.logic.mqtt-send',parameters:{...moduleDefaults('clex.logic.mqtt-send'),componentId,qos:String(qos),payloadEncoding:encoding,messageExpiry:-1,payloadFormatIndicator:'unspecified',topic:'shared/value',payload:encoding==='hex'?'00ff':'hello',userProperties:'[]'}});
const nodes=[receive('r0','mqtt-a',[{topic:'shared/+',qos:1},{topic:'extra/#',qos:1}]),receive('r1','mqtt-a',[{topic:'shared/+',qos:2}]),receive('r2','mqtt-b',[{topic:'binary/#',qos:2}],'hex'),receive('r3','mqtt-b',[{topic:'binary/#',qos:1}],'base64'),send('s0','mqtt-b',1),send('s1','mqtt-a',2,'hex'),send('s2','mqtt-c',0)];
const cString=value=>JSON.stringify(String(value)).replace(/\\u([0-9a-fA-F]{4})/g,'\\u$1');
Object.assign(nodes[4].parameters,{contentType:'text/plain',responseTopic:'reply/value',correlationData:'AP8=',userProperties:'[{"key":"source","value":"CLEX"}]',messageExpiry:60,payloadFormatIndicator:'1'});
project.logic={nodes,edges:[]};
const runtime=mqttFirmware(project,catalog,nodes,new Map(nodes.map((n,i)=>[n.id,i])),cString);
writeFileSync(join(root,'mbedtls-test-config.h'),'#define MBEDTLS_BASE64_C\n');
const main=join(root,'runtime.c');writeFileSync(main,readFileSync('tests/mqtt-host/runtime-support.h','utf8')+'\n'+runtime.source+'\n'+readFileSync('tests/mqtt-host/runtime-main.c','utf8'));
const mbed=join(sdk,'components/mbedtls/mbedtls'),json=join(sdk,'components/json/cJSON');
let exe;try{exe=compileHost(main,{output:'mqtt-runtime',extra:[...(process.env.CLEX_TEST_ASAN?['-fsanitize=address','-fno-omit-frame-pointer']:[]),'-I'+join(mbed,'include'),'-I'+join(mbed,'library'),'-I'+json,'-DMBEDTLS_CONFIG_FILE="'+join(root,'mbedtls-test-config.h')+'"',join(mbed,'library/base64.c'),join(mbed,'library/constant_time.c'),join(mbed,'library/platform_util.c'),join(json,'cJSON.c')]});}catch(error){for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));throw error;}
const config=join(root,'broker.conf');writeFileSync(config,`listener ${port} 127.0.0.1\nallow_anonymous true\n`);
let brokerProcess,client;
async function stop(p){if(p&&p.exitCode===null&&p.signalCode===null){p.kill('SIGTERM');await Promise.race([once(p,'exit'),new Promise(r=>setTimeout(()=>{p.kill('SIGKILL');r();},2000))]);}}
async function start(){brokerProcess=spawn(broker,['-c',config],{stdio:'ignore'});for(let i=0;i<100;i++){try{await new Promise((resolve,reject)=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.end();resolve();});s.once('error',reject);});return;}catch{await new Promise(r=>setTimeout(r,20));}}throw Error('Broker failed to start');}
try{await start();client=spawn(exe,[],{stdio:['pipe','pipe','pipe']});let stderr='';client.stderr.on('data',d=>stderr+=d);const timer=setTimeout(()=>client.kill('SIGKILL'),60000);let restart=Promise.resolve();createInterface({input:client.stdout}).on('line',line=>{if(line==='RESTART')restart=restart.then(async()=>{await stop(brokerProcess);await new Promise(r=>setTimeout(r,500));await start();client.stdin.write('R\n');});else console.log(line);});const [code,signal]=await once(client,'exit');clearTimeout(timer);await restart;if(code!==0)throw Error(`Generated MQTT runtime exited ${code}/${signal}\n${stderr}`);}finally{await stop(client);await stop(brokerProcess);for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));}
