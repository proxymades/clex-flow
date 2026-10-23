import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {catalog} from '../tests/catalog-fixture.js';
import {mqttProject} from '../tests/mqtt-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
export const cases=[['s3-ethernet-311',{protocol:'3.1.1'}],['s3-ethernet-5',{clients:2,tls:true}],['esp32-wifi',{boardId:'doit-esp32-devkit-v1-30pin',network:'wifi'}],['s3-devkit-wifi',{boardId:'espressif-devkitc-1-v1-1-n8r8',network:'wifi'}],['s3-wifi',{network:'wifi'}],['p4-ethernet',{boardId:'waveshare-esp32-p4-nano',clients:2,tls:true}],['p4-wifi',{boardId:'waveshare-esp32-p4-nano',network:'wifi'}],['s3-auto-only',{nodes:false}]];
for(const [name,options]of cases){
 if(process.env.CLEX_MQTT_CASE&&process.env.CLEX_MQTT_CASE!==name)continue;
 const {project}=mqttProject(options),bundle=generateFirmware(project,catalog),root=resolve('.artifacts/mqtt/build',name);
 for(const [file,source]of Object.entries(bundle.files)){const path=join(root,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,source);}
 if(process.argv.includes('--generate-only')){console.log('Generated '+name);continue;}
 if(!process.env.IDF_PATH)throw Error('Activate ESP-IDF 5.4.4 before MQTT cross builds.');
 const env={...process.env,IDF_TARGET:bundle.target};
 for(const [command,args]of [[process.env.CLEX_IDF_PYTHON||'python',[join(process.env.IDF_PATH,'tools/idf.py'),'-B','build-check','reconfigure']],['ninja',['-C','build-check','-j','2']]]){
  const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});if(result.status!==0)throw Error(name+': build failed');
 }
 console.log('PASS build '+name);
}
