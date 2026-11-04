import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {catalog} from './catalog-fixture.js';
import {testKey} from './espnow-fixture.js';
import {parseProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
test('all shipped examples generate after filling only deployment-specific connection settings in memory',()=>{
 for(const file of readdirSync(new URL('../examples/',import.meta.url)).filter(f=>f.endsWith('.json'))){
  const path=new URL('../examples/'+file,import.meta.url),raw=readFileSync(path,'utf8'),project=parseProject(raw);
  for(const component of project.components){
   if(component.moduleId==='clex.hardware.router')Object.assign(component.parameters,{staSsid:'Fixture WAN',staPassword:'fixture-wan-key',apPassword:'fixture-lan-key',adminUser:'fixture',adminPassword:'fixture-admin-key'});
   if(component.moduleId==='clex.hardware.espnow'){
    component.parameters.pmk=testKey;
    component.parameters.peers=JSON.stringify(JSON.parse(component.parameters.peers).map((peer,i)=>({...peer,mac:'02:11:22:33:44:'+String(10+i),lmk:testKey})));
   }
  }
  assert.doesNotThrow(()=>generateFirmware(project,catalog),file);
  assert.equal(readFileSync(path,'utf8'),raw);
 }
});
