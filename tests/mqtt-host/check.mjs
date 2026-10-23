import process from 'node:process';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {compileHost} from './build.mjs';
const root=resolve('.artifacts/mqtt/integration');mkdirSync(root,{recursive:true});
const broker=process.env.CLEX_TEST_MOSQUITTO||resolve('.artifacts/mqtt/deps/build/src/mosquitto');
if(!existsSync(broker))throw Error('Set CLEX_TEST_MOSQUITTO to a local Mosquitto executable; this check downloads nothing.');
const exe=compileHost(resolve('tests/mqtt-host/suite.c'),{output:'mqtt-integration'});
const children=new Set();
function launch(exe,args){const p=spawn(exe,args,{stdio:['pipe','pipe','pipe']});children.add(p);p.once('exit',()=>children.delete(p));return p;}
async function stop(p){if(!p||p.exitCode!==null||p.signalCode!==null)return;p.kill('SIGTERM');await Promise.race([once(p,'exit'),new Promise(resolve=>setTimeout(()=>{p.kill('SIGKILL');resolve();},2500))]);}
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p;}
async function ready(p){for(let n=0;n<100;n++){try{await new Promise((resolve,reject)=>{const s=net.connect(p,'127.0.0.1');s.once('connect',()=>{s.end();resolve();});s.once('error',reject);});return;}catch{await new Promise(r=>setTimeout(r,20));}}throw Error('Broker did not listen');}
async function startBroker(file,p){const b=launch(broker,['-c',file]);let log='';b.stderr.on('data',d=>log+=d);b.stdout.resume();await ready(p);return b;}
async function run(args,onLine){const p=launch(exe,args);let stderr='';p.stderr.on('data',d=>stderr+=d);const timer=setTimeout(()=>p.kill('SIGKILL'),45000);const rl=createInterface({input:p.stdout});let pending=Promise.resolve();rl.on('line',line=>{if(line==='RESTART')pending=pending.then(()=>onLine(p));else console.log(line);});const [code,signal]=await once(p,'exit');clearTimeout(timer);await pending;if(code!==0)throw Error(`MQTT host check exited ${code}/${signal}\n${stderr}`);}
function openssl(args){const result=spawnSync(process.env.CLEX_TEST_OPENSSL||'/opt/homebrew/opt/openssl@3/bin/openssl',args,{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}
try{
 for(const version of [4,5]){const p=await port();const file=join(root,`broker-${version}.conf`);writeFileSync(file,`listener ${p} 127.0.0.1\nallow_anonymous true\n`);let b=await startBroker(file,p);try{await run(['basic',String(p),String(version)],async client=>{await stop(b);await new Promise(r=>setTimeout(r,400));b=await startBroker(file,p);client.stdin.write('R\n');});}finally{await stop(b);}}
 const authPort=await port(),authConf=join(root,'broker-auth.conf'),passwords=join(root,'passwords');
 const passwd=process.env.CLEX_TEST_MOSQUITTO_PASSWD||resolve('.artifacts/mqtt/deps/build/apps/mosquitto_passwd/mosquitto_passwd');
 if(!existsSync(passwd))throw Error('Set CLEX_TEST_MOSQUITTO_PASSWD to a local mosquitto_passwd executable.');
 const passwordResult=spawnSync(passwd,['-b','-c',passwords,'clex-test','local-test-only'],{encoding:'utf8'});if(passwordResult.status!==0)throw Error(passwordResult.stderr);
 writeFileSync(authConf,`listener ${authPort} 127.0.0.1\nallow_anonymous false\npassword_file ${passwords}\n`);const authBroker=await startBroker(authConf,authPort);try{for(const version of [4,5])await run(['auth',String(authPort),String(version)]);}finally{await stop(authBroker);}
 const ca=join(root,'ca.pem'),key=join(root,'ca.key'),server=join(root,'server.pem'),serverKey=join(root,'server.key'),csr=join(root,'server.csr'),bad=join(root,'wrong-ca.pem');
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',ca,'-days','2','-subj','/CN=CLEX MQTT test CA']);
 openssl(['req','-newkey','rsa:2048','-nodes','-keyout',serverKey,'-out',csr,'-subj','/CN=localhost']);writeFileSync(join(root,'extensions.cnf'),'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
 openssl(['x509','-req','-in',csr,'-CA',ca,'-CAkey',key,'-CAcreateserial','-out',server,'-days','2','-extfile',join(root,'extensions.cnf')]);
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'wrong-ca.key'),'-out',bad,'-days','2','-subj','/CN=Wrong local test CA']);
 const p=await port(),file=join(root,'broker-tls.conf');writeFileSync(file,`listener ${p} 127.0.0.1\nallow_anonymous true\ncertfile ${server}\nkeyfile ${serverKey}\ncafile ${ca}\n`);const b=await startBroker(file,p);try{await run(['tls',String(p),ca,bad]);}finally{await stop(b);}
 let zeroChecked=false,negativeChecked=false;const mock=net.createServer(socket=>{let bytes=Buffer.alloc(0),publishes=0;socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);while(bytes.length>=2){let remaining=0,mult=1,end=1;for(;;){if(end>=bytes.length)return;const v=bytes[end++];remaining+=(v&127)*mult;if(!(v&128))break;mult*=128;}if(bytes.length<end+remaining)return;const header=bytes[0],body=bytes.subarray(end,end+remaining);bytes=bytes.subarray(end+remaining);switch(header>>4){case 1:socket.write(Buffer.from([0x20,6,0,0,3,0x21,0,1]));break;case 3:{publishes++;const topicLen=body.readUInt16BE(0),id=body.readUInt16BE(2+topicLen);if(publishes===1){const properties=body.subarray(5+topicLen,5+topicLen+body[4+topicLen]);if(!properties.equals(Buffer.from([1,0,2,0,0,0,0])))throw Error('Explicit zero properties missing: '+properties.toString('hex'));zeroChecked=true;socket.write(Buffer.from([0x50,4,id>>8,id&255,0x87,0]));}else socket.write(Buffer.from([0x50,2,id>>8,id&255]));break;}case 6:if(publishes===1)throw Error('Sent PUBREL after negative PUBREC');negativeChecked=true;socket.write(Buffer.from([0x70,2,body[0],body[1]]));break;case 12:socket.write(Buffer.from([0xd0,0]));break;case 14:socket.end();break;default:throw Error('Unexpected packet '+header);}}});});
 mock.listen(0,'127.0.0.1');await once(mock,'listening');try{await run(['negative',String(mock.address().port)]);if(!zeroChecked||!negativeChecked)throw Error('Negative ACK exchange incomplete');}finally{await new Promise(resolve=>mock.close(resolve));}
 console.log('All real ESP-MQTT host integration checks passed. TLS uses the POSIX OpenSSL adapter; embedded TLS/device validation remains separate.');
}finally{await Promise.all([...children].map(stop));}
