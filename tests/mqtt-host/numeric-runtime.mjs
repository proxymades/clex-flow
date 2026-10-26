import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {compileHost} from './build.mjs';
import {numericProject} from '../numeric-fixture.js';
import {numericGraphSource} from '../numeric-generated.js';
import {catalog} from '../catalog-fixture.js';
import {addNode,connectNodes,withLogic} from '../../src/logic/model.js';
import {mqttFirmware} from '../../src/firmware/drivers/mqtt.js';
import {cString} from '../../src/firmware/generator.js';

const sdk=process.env.CLEX_TEST_IDF_ROOT||process.env.IDF_PATH;
if(!sdk)throw Error('Set CLEX_TEST_IDF_ROOT to ESP-IDF 5.4.4.');
const broker=process.env.CLEX_TEST_MOSQUITTO||resolve('.artifacts/mqtt/deps/build/src/mosquitto');
if(!existsSync(broker))throw Error('Set CLEX_TEST_MOSQUITTO to a local Mosquitto binary.');
const root=resolve('.artifacts/numeric/mqtt');mkdirSync(root,{recursive:true});
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const port=listener.address().port;await new Promise(r=>listener.close(r));
writeFileSync(join(root,'broker.conf'),'listener '+port+' 127.0.0.1\nallow_anonymous true\n');
const children=new Set();
const launch=(file,args)=>{const p=spawn(file,args,{stdio:['ignore','pipe','pipe']});children.add(p);p.once('exit',()=>children.delete(p));return p;};
try {
 const server=launch(broker,['-c',join(root,'broker.conf')]);server.stdout.resume();server.stderr.resume();
 for(let i=0;i<100;i++){try{await new Promise((r,j)=>{const socket=net.connect(port,'127.0.0.1');socket.once('connect',()=>{socket.end();r();});socket.once('error',j);});break;}catch{await new Promise(r=>setTimeout(r,20));}}
 const executables=[];
 for(const protocol of ['3.1.1','5.0']){
  let {project,nodes}=numericProject('doit-esp32-devkit-v1-30pin',{mqtt:true});
  const connection=project.components.find(c=>c.moduleId==='clex.hardware.mqtt'),topic='clex/test/value/'+protocol;
  Object.assign(connection.parameters,{host:'127.0.0.1',port,protocol,clientId:'numeric-'+protocol});
  nodes.source.parameters.filters=JSON.stringify([{topic,qos:1}]);
  project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.mqtt-send'),project.components,project,catalog));
  const sender=project.logic.nodes.at(-1);Object.assign(sender.parameters,{componentId:connection.id,topic,payload:'0.0 Па',qos:'1',retain:true});
  project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.timer'),project.components,project,catalog));
  const clock=project.logic.nodes.at(-1);
  project=withLogic(project,connectNodes(project.logic,catalog,{source:clock.id,sourceHandle:'tick',target:sender.id,targetHandle:'trigger'},project));
  const graph=numericGraphSource(project,nodes,{includeSource:true,extraNodes:[sender]});
  const sorted=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),runtime=mqttFirmware(project,catalog,sorted,graph.index,cString);
  const prefix=String.raw`
static int gpio_set_level(int pin,int level){(void)pin;(void)level;return 0;}
#define ESP_ERROR_CHECK(call) assert((call)==0)
`;
  const main=String.raw`
static unsigned received;
static void clex_mq_notify(unsigned kind,unsigned slot,unsigned node){
 clex_graph_mq_notify(kind,slot,node);
 if(kind==MQ_RECEIVED)received++;
 if(kind==MQ_SEND_FAILED||kind==MQ_CLIENT_FAILED||kind==MQ_RECEIVE_FAILED){fprintf(stderr,"MQTT failure: %s\n",mq_clients[0].error);abort();}
}
static void pump(unsigned milliseconds){uint64_t end=platform_tick_get_ms()+milliseconds;do{clex_mq_poll();usleep(5000);}while(platform_tick_get_ms()<end);}
static void check(const char *payload,bool low,bool high){
 unsigned expected=received+1;clex_mq_send(0,${cString(topic)},payload);
 uint64_t deadline=platform_tick_get_ms()+5000;
 while(received<expected&&platform_tick_get_ms()<deadline)pump(5);
 assert(received==expected);
 assert(relay_state_0[0]==low&&relay_state_0[1]==high);
 printf("${protocol}: %s -> relay1=%d relay2=%d\n",payload,low,high);
}
int main(void){
 signal(SIGPIPE,SIG_IGN);clex_mq_initialize();uint64_t deadline=platform_tick_get_ms()+10000;
 while((!mq_clients[0].connected||!mq_owners[0].settled)&&platform_tick_get_ms()<deadline)pump(5);
 assert(mq_clients[0].connected&&mq_owners[0].settled);
 check("-12000.0 Па",true,false);check("12000.0 Па",false,true);
 check("-10000.0 Па",false,false);check("10000.0 Па",false,false);
 check("0.0 Па",false,false);check("Нет данных",false,false);
 check("-1.5e4 Па",true,false);check("NaN Па",false,false);
 check("12000.5 Па",false,true);check("500 кПа",false,false);
 check("-12000,5 Па",true,false);check("1e999 Па",false,false);
 pump(100);clex_mq_disconnect(0);pump(100);
 puts("PASS real MQTT ${protocol}: generated receive/conversion/range/relay chain, boundaries, malformed input and recovery");
 return 0;
}
`;
  const source=readFileSync('tests/mqtt-host/runtime-support.h','utf8')+'\n'+runtime.source+'\n'+prefix+'\n'+graph.source+'\n'+runtime.notify.replace('static void clex_mq_notify(','static void clex_graph_mq_notify(')+'\n'+main;
  const file=join(root,'numeric-'+protocol+'.c');writeFileSync(file,source);
  writeFileSync(join(root,'mbedtls-test-config.h'),'#define MBEDTLS_BASE64_C\n');
  const mbed=join(sdk,'components/mbedtls/mbedtls'),json=join(sdk,'components/json/cJSON');
  executables.push(compileHost(file,{output:'numeric-'+protocol,extra:['-I'+join(mbed,'include'),'-I'+join(mbed,'library'),'-I'+json,'-DMBEDTLS_CONFIG_FILE="'+join(root,'mbedtls-test-config.h')+'"',join(mbed,'library/base64.c'),join(mbed,'library/constant_time.c'),join(mbed,'library/platform_util.c'),join(json,'cJSON.c')]}));
 }
 await Promise.all(executables.map(async executable=>{
  const child=launch(executable,[]);let error='';child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>error+=data);
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);const [code,signal]=await once(child,'exit');clearTimeout(timer);
  if(code!==0)throw Error('MQTT numerical integration failed: '+code+'/'+signal+'\n'+error);
 }));
} finally {
 for(const child of [...children]){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1500))]);}
}
