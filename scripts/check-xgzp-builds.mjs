import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {catalog} from '../tests/catalog-fixture.js';
import {xgzpProject} from '../tests/xgzp-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
const cases=[['esp32','doit-esp32-devkit-v1-30pin'],['s3','waveshare-esp32-s3-eth'],['p4','waveshare-esp32-p4-nano'],['nano','arduino-nano-atmega328p-ch340']];
for(const [name,boardId] of cases){
 if(process.env.CLEX_XGZP_BUILD_CASE&&process.env.CLEX_XGZP_BUILD_CASE!==name)continue;
 const {project}=xgzpProject(boardId),bundle=generateFirmware(project,catalog),root=resolve('.artifacts/xgzp/build',name);
 for(const [file,source]of Object.entries(bundle.files)){const path=join(root,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,source);}
 if(process.argv.includes('--generate-only')){console.log('Generated '+name);continue;}
 let commands,env={...process.env};
 if(name==='nano'){
  if(!env.CLEX_ARDUINO_CLI)throw Error('Set CLEX_ARDUINO_CLI to an Arduino CLI with AVR core 1.8.6.');
  commands=[[env.CLEX_ARDUINO_CLI,['compile','--fqbn','arduino:avr:nano:cpu=atmega328','--build-path',join(root,'build-check'),join(root,'clex_flow')]]];
 }else{
  if(!env.IDF_PATH)throw Error('Activate ESP-IDF 5.4.4 before XGZP cross builds.');
  env={...env,IDF_TARGET:bundle.target};
  commands=[[env.CLEX_IDF_PYTHON||'python',[join(env.IDF_PATH,'tools/idf.py'),'-B','build-check','reconfigure']],['ninja',['-C','build-check','-j','2']]];
 }
 for(const [command,args] of commands){const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});if(result.status!==0)throw Error(name+': build failed');}
 console.log('PASS build '+name);
}
