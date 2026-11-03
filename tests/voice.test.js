import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalog} from './catalog-fixture.js';
import {voiceProject} from './voice-fixture.js';
import {emptyVoiceProfile,readVoiceProfile,voiceProfileProblem,voiceModelReady,voiceSignature,voicePorts,voicePlan,voiceTrainingProblem,VOICE_MODULE,SPEAKER_MODULE} from '../src/voice/model.js';
import {generateFirmware,cString} from '../src/firmware/generator.js';
import {serializeProject,parseProject} from '../src/projects/model.js';
import {nodePorts,validateGraph,addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {validateAssembly,addHardware} from '../src/assembly/model.js';

test('new voice component has an empty vocabulary and user-controlled recording counts',()=>{
 const p=voiceProject({trained:false,serial:false}),profile=readVoiceProfile(p.components[0]);
 assert.equal(voiceProfileProblem(profile),null);assert.equal(voiceModelReady(profile),false);
 const fresh=emptyVoiceProfile();assert.deepEqual(fresh.commands,[]);assert.deepEqual(fresh.samples,[]);
 const plan=voicePlan(profile);assert.equal(plan.length,profile.commands.length*profile.repeats+profile.unknownCount+profile.backgroundCount);
 assert.ok(voiceTrainingProblem(profile));assert.equal(voicePlan({...profile,repeats:8}).length-plan.length,profile.commands.length*3);
});
test('command outputs keep their identity on renaming and arbitrary vocabulary sizes generate code',()=>{
 for(const size of [1,4,9]){
  const p=voiceProject({phrases:Array.from({length:size},(_,i)=>'Собственная команда '+(i+1))});
  const component=p.components[0],profile=readVoiceProfile(component),node=p.logic.nodes[0];
  const ports=voicePorts(component);assert.equal(ports.length,size);
  assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);
  const bundle=generateFirmware(p,catalog);assert.ok(bundle.featureRuntimes.includes('voice-p4'));assert.match(bundle.mainC,new RegExp('\\.commands='+size+'[,}]'));
  assert.ok(bundle.mainC.includes(cString(profile.commands[0].phrase)));
  profile.commands[0].phrase='Переименованная команда';component.parameters.profile=JSON.stringify(profile);
  assert.equal(voicePorts(component)[0].id,ports[0].id);assert.equal(voiceModelReady(profile),false);
  assert.ok(nodePorts(node,catalog,p).outputs.some(port=>port.id===ports[0].id));
  const removed=structuredClone(p),rp=readVoiceProfile(removed.components[0]);rp.commands.shift();rp.samples=rp.samples.filter(s=>s.commandId!==profile.commands[0].id);rp.model=null;removed.components[0].parameters.profile=JSON.stringify(rp);assert.ok(validateGraph(removed,catalog).some(i=>i.severity==='error'));
 }
});
test('voice profile and prepared model survive export and detect malformed/stale data',()=>{
 const p=voiceProject(),profile=readVoiceProfile(p.components[0]);
 assert.equal(voiceModelReady(profile),true);assert.deepEqual(parseProject(serializeProject(p)),p);
 const bad=structuredClone(profile);bad.samples[0].data='broken';assert.ok(voiceProfileProblem(bad));
 const missing=structuredClone(profile);missing.model.referenceIds.push('0'.repeat(64));assert.ok(voiceProfileProblem(missing));
 const duplicate=structuredClone(profile);duplicate.commands[1].phrase=duplicate.commands[0].phrase;assert.ok(voiceProfileProblem(duplicate));
 profile.samples.pop();assert.notEqual(voiceSignature(profile),profile.model.signature);
});
test('recording firmware builds before training, owns audio resources and includes the wake model partition',()=>{
 const p=voiceProject({trained:false}),bundle=generateFirmware(p,catalog);
 assert.match(bundle.mainC,/\.reference_count=0/);assert.match(bundle.files['partitions.csv'],/model,data,,0x610000,0x100000/);
 assert.ok(bundle.files['components/clex_voice/core.c']);assert.ok(bundle.files['components/clex_voice/runtime.c']);
 assert.match(bundle.files['main/idf_component.yml'],/esp-sr: "=2.6.1"/);
 assert.throws(()=>addHardware(p,catalog.modules.find(m=>m.id===VOICE_MODULE),catalog),/уже добавлен/);
 const shared=addHardware(p,catalog.modules.find(m=>m.id===SPEAKER_MODULE),catalog);assert.equal(validateAssembly(shared,catalog).filter(i=>i.severity==='error').length,0);
 const duplicate=addHardware(shared,catalog.modules.find(m=>m.id===SPEAKER_MODULE),catalog);assert.ok(validateAssembly(duplicate,catalog).some(i=>i.severity==='error'&&i.code==='hardware-resource'));
 const source=readFileSync('src/firmware/components/clex_voice/core.c','utf8');assert.doesNotMatch(source,/lamp1|lamp2|both_on|both_off/);
});

test('malformed imported commands and audio are rejected without throwing',()=>{
 const profile=readVoiceProfile(voiceProject().components[0]);
 for(const command of [null,{},false,42]){const p=structuredClone(profile);p.commands[0]=command;assert.ok(voiceProfileProblem(p));}
 for(const sample of [null,{},false,42]){const p=structuredClone(profile);p.samples[0]=sample;assert.ok(voiceProfileProblem(p));}
 const p=structuredClone(profile);p.samples[0].data+='!';assert.ok(voiceProfileProblem(p));
});
test('voice model partition takes priority over Wi-Fi and router OTA layouts',()=>{
 for(const network of ['wifi','router']){
  const p=addHardware(voiceProject(),catalog.modules.find(m=>m.id==='clex.hardware.'+network),catalog);
  if(network==='wifi')p.components.at(-1).parameters.ssid='Voice build test';
 if(network==='router')Object.assign(p.components.at(-1).parameters,{staSsid:'Voice build test',staPassword:'test-wan-key',apPassword:'test-lan-key',adminPassword:'test-admin-key'});
  const bundle=generateFirmware(p,catalog);
  assert.match(bundle.files['partitions.csv'],/model,data,,0x[0-9a-f]+,0x100000/);
  assert.ok(bundle.featureRuntimes.includes('voice-p4'));
  if(bundle.featureRuntimes.includes('router-ota-esp32p4'))assert.match(bundle.files['partitions.csv'],/ota_1/);
 }
});

test('sound blocks reuse the voice codec and report asynchronous completion',()=>{
 let p=voiceProject({speaker:true,activationSound:true});
 let graph=addNode(p.logic,catalog.modules.find(m=>m.id==='clex.logic.tone'),p.components,p,catalog);
 const tone=graph.nodes.at(-1);
 assert.equal(tone.parameters.componentId,p.components[1].id);
 graph=connectNodes(graph,catalog,{source:graph.nodes[0].id,sourceHandle:'recognized',target:tone.id,targetHandle:'trigger'},{...p,logic:graph});
 p=withLogic(p,graph);const bundle=generateFirmware(p,catalog);
 assert.match(bundle.mainC,/clex_voice_tone\(/);assert.match(bundle.mainC,/CV_TONE_DONE/);
 assert.doesNotMatch(bundle.mainC,/media_initialize\(/);
});
test('voice references preserve feature scales and invalidate models when encoding changes',()=>{
 const project=voiceProject(),component=project.components[0],profile=readVoiceProfile(component),original=voiceSignature(profile);
 profile.samples[0].scale=4096;assert.equal(voiceSignature(profile),original);
 profile.samples[0].scale=2048;assert.notEqual(voiceSignature(profile),original);assert.equal(voiceProfileProblem(profile),null);assert.equal(voiceModelReady(profile),false);
 profile.model.signature=voiceSignature(profile);component.parameters.profile=JSON.stringify(profile);
 assert.match(generateFirmware(project,catalog).mainC,/voice_reference_0,12,0,2048/);
 profile.samples[0].scale=0;assert.ok(voiceProfileProblem(profile));
});

test('recognition works without a speaker and activation sound requires a selected speaker',()=>{
 const p=voiceProject(),voice=p.components[0];
 assert.equal(voice.parameters.activationSound,false);assert.equal(voice.parameters.speakerId,'');assert.equal(voice.parameters.volume,undefined);
 assert.equal(validateAssembly(p,catalog).filter(i=>i.severity==='error').length,0);
 assert.match(generateFirmware(p,catalog).mainC,/\.speaker_enabled=false,\.activation_sound=false/);
 voice.parameters.activationSound=true;
 assert.ok(validateAssembly(p,catalog).some(i=>i.code==='voice-speaker'));
 assert.throws(()=>generateFirmware(p,catalog));
 const shared=voiceProject({speaker:true,activationSound:true});
 assert.equal(validateAssembly(shared,catalog).filter(i=>i.severity==='error').length,0);
 assert.match(generateFirmware(shared,catalog).mainC,/\.speaker_enabled=true,\.activation_sound=true/);
 shared.components[0].parameters.activationVolume=0;
 assert.match(generateFirmware(shared,catalog).mainC,/\.activation_sound=false/);
 shared.components.pop();
 assert.ok(validateAssembly(shared,catalog).some(i=>i.code==='voice-speaker'));
 shared.components[0].parameters.activationSound=false;
 assert.equal(validateAssembly(shared,catalog).filter(i=>i.severity==='error').length,0);
 shared.components[0].parameters.interfaceId='missing';
 assert.ok(validateAssembly(shared,catalog).some(i=>i.code==='voice-microphone'));
});

test('legacy voice projects keep recordings, models, graph links and speaker playback',()=>{
 const legacy=voiceProject(),voice=legacy.components[0],originalProfile=voice.parameters.profile;
 delete voice.parameters.activationSound;delete voice.parameters.speakerId;delete voice.parameters.activationVolume;voice.parameters.volume=72;
 // An old tone block was bound directly to the voice component.
 legacy.logic.nodes.push({id:crypto.randomUUID(),moduleId:'clex.logic.tone',moduleVersion:'1.0.0',name:'Звуковой сигнал 1',position:{x:100,y:100},parameters:{componentId:voice.id,frequencyHz:800,durationMs:200,volume:50}});
 legacy.moduleVersions['clex.logic.tone']='1.0.0';
 legacy.logic=connectNodes(legacy.logic,catalog,{source:legacy.logic.nodes[0].id,sourceHandle:'recognized',target:legacy.logic.nodes.at(-1).id,targetHandle:'trigger'},legacy);
 const edges=structuredClone(legacy.logic.edges);
 const migrated=parseProject(JSON.stringify(legacy)),speaker=migrated.components.find(c=>c.moduleId===SPEAKER_MODULE),next=migrated.components[0];
 assert.equal(parseProject(JSON.stringify(legacy)).components.find(c=>c.moduleId===SPEAKER_MODULE).id,speaker.id);
 assert.ok(speaker);assert.equal(next.parameters.profile,originalProfile);assert.equal(voiceModelReady(readVoiceProfile(next)),true);
 assert.equal(next.parameters.activationSound,true);assert.equal(next.parameters.activationVolume,72);assert.equal(next.parameters.speakerId,speaker.id);assert.equal(next.parameters.volume,undefined);
 assert.deepEqual(migrated.logic.edges,edges);assert.equal(migrated.logic.nodes.at(-1).parameters.componentId,speaker.id);
 assert.deepEqual(parseProject(serializeProject(migrated)),migrated);
 assert.equal(validateAssembly(migrated,catalog).filter(i=>i.severity==='error').length,0);
 assert.equal(validateGraph(migrated,catalog).filter(i=>i.severity==='error').length,0);
 assert.match(generateFirmware(migrated,catalog).mainC,/\.speaker_enabled=true,\.activation_sound=true/);
 assert.equal(legacy.components.length,1);assert.equal(legacy.components[0].parameters.volume,72);
});

test('a legacy muted voice project does not require a speaker and migration reuses an existing speaker',()=>{
 for(const speaker of [false,true]){
  const legacy=voiceProject({speaker}),voice=legacy.components[0];
  delete voice.parameters.activationSound;delete voice.parameters.speakerId;delete voice.parameters.activationVolume;voice.parameters.volume=speaker?85:0;
  const migrated=parseProject(JSON.stringify(legacy));
  assert.equal(migrated.components.length,speaker?2:1);assert.equal(migrated.components[0].parameters.activationSound,speaker);
  if(speaker)assert.equal(migrated.components[0].parameters.speakerId,legacy.components[1].id);
  assert.equal(validateAssembly(migrated,catalog).filter(i=>i.severity==='error').length,0);
 }
});

test('legacy speaker placement stays within the canvas near its right edge',()=>{
 const legacy=voiceProject(),voice=legacy.components[0];
 delete voice.parameters.activationSound;delete voice.parameters.speakerId;delete voice.parameters.activationVolume;voice.parameters.volume=85;
 legacy.assembly.positions[voice.id]={x:4900,y:4900};
 const migrated=parseProject(JSON.stringify(legacy)),speaker=migrated.components.find(c=>c.moduleId===SPEAKER_MODULE),position=migrated.assembly.positions[speaker.id];
 assert.ok(Math.abs(position.x)<=5000&&Math.abs(position.y)<=5000);
 assert.equal(migrated.components[0].parameters.profile,voice.parameters.profile);
});
