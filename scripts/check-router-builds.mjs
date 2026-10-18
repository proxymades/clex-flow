import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {routerProject,routerDisplayProject} from '../tests/router-fixture.js';
import {catalog} from '../tests/catalog-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';

export const cases=[['s3-display',{display:true}],['s3-wifi',{}],['s3-no-ota',{ota:false}],['s3-ethernet',{wan:'ethernet',backup:'wifi',staticWan:true}],['s3-eth-lan',{lan:'ethernet'}],['s3-devkit',{boardId:'espressif-devkitc-1-v1-1-n8r8'}],['p4-wifi',{boardId:'waveshare-esp32-p4-nano'}],['p4-ethernet',{boardId:'waveshare-esp32-p4-nano',wan:'ethernet'}],['p4-eth-lan',{boardId:'waveshare-esp32-p4-nano',lan:'ethernet',staticWan:true}]];
const only=process.env.CLEX_ROUTER_CASE;
for(const [name,options] of cases){
 if(only&&name!==only)continue;
 const bundle=generateFirmware((options.display?routerDisplayProject():routerProject(options)).project,catalog),root=resolve('.artifacts/router-build',name);
 for(const [name,source] of Object.entries(bundle.files)){const path=join(root,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,source);}
 if(process.argv.includes('--generate-only')){console.log('Generated: '+name);continue;}
 if(!process.env.IDF_PATH)throw Error('Activate ESP-IDF 5.4.4 before running router builds.');
 const env={...process.env,IDF_TARGET:bundle.target};
 for(const [command,args] of [[process.env.CLEX_IDF_PYTHON||'python',[join(process.env.IDF_PATH,'tools/idf.py'),'-B','build-check','reconfigure']],['ninja',['-C','build-check','-j','2']]]){
  const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});if(result.status!==0)throw Error(name+': build failed');
 }
 console.log('PASS build: '+name);
}
