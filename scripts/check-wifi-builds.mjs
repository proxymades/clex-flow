import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {catalog} from '../tests/catalog-fixture.js';
import {wifiProject} from '../tests/wifi-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
export const cases=[['esp32-sta',{boardId:'doit-esp32-devkit-v1-30pin',mqtt:true}],['s3-sta-static',{boardId:'espressif-devkitc-1-v1-1-n8r8',staticIp:true,mqtt:true}],['p4-sta',{boardId:'waveshare-esp32-p4-nano',mqtt:true}]];
for(const [name,options]of cases){
 if(process.env.CLEX_WIFI_BUILD_CASE&&process.env.CLEX_WIFI_BUILD_CASE!==name)continue;
 const {project}=wifiProject(options),bundle=generateFirmware(project,catalog),root=resolve('.artifacts/wifi/build',name);
 for(const [file,source]of Object.entries(bundle.files)){const path=join(root,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,source);}
 if(process.argv.includes('--generate-only')){console.log('Generated '+name);continue;}
 if(!process.env.IDF_PATH)throw Error('Activate ESP-IDF 5.4.4 before Wi-Fi cross builds.');
 const env={...process.env,IDF_TARGET:bundle.target};
 for(const [command,args]of [[process.env.CLEX_IDF_PYTHON||'python',[join(process.env.IDF_PATH,'tools/idf.py'),'-B','build-check','reconfigure']],['ninja',['-C','build-check','-j','2']]]){
  const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});if(result.status!==0)throw Error(name+': build failed');
 }
 console.log('PASS build '+name);
}
