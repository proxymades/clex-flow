import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {voiceProject,withCustomWake} from './voice-fixture.js';
import {microphoneProject} from './microphone-fixture.js';
import {readVoiceProfile,readWakeProfile,wakeProfileProblem,wakePhrase,wakeModelReady,voiceModelReady,voiceProfileProblem,voiceRuntimeSignature,voiceSignature,voicePlan,voiceTrainingProblem} from '../src/voice/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {validateAssembly} from '../src/assembly/model.js';

test('custom activation has independent records, command identity and deployment signature',()=>{
 const p=voiceProject(),voice=p.components[0],commands=voice.parameters.profile,ports=structuredClone(p.logic);
 const original=voiceRuntimeSignature(voice,p,catalog.boards.find(b=>b.id===p.boardId));
 withCustomWake(p);const wake=readWakeProfile(voice),board=catalog.boards.find(b=>b.id===p.boardId);
 assert.equal(wakeProfileProblem(wake),null);assert.equal(voiceTrainingProblem(wake),null);assert.equal(wakePhrase(voice),'Добрый вечер, дом');
 assert.equal(wakeModelReady(voice,p,board),true);assert.equal(voice.parameters.profile,commands);assert.deepEqual(p.logic,ports);
 assert.notEqual(voiceRuntimeSignature(voice,p,board),original);assert.deepEqual(parseProject(serializeProject(p)),p);
 wake.commands[0].phrase='Доброе утро, дом';voice.parameters.wakeProfile=JSON.stringify(wake);
 assert.equal(wakeModelReady(voice,p,board),false);assert.equal(voiceModelReady(readVoiceProfile(voice)),true);
 assert.equal(voice.parameters.profile,commands);
 voice.parameters.wakeMode='builtin';assert.equal(voiceRuntimeSignature(voice,p,board),original);assert.equal(wakePhrase(voice),'Привет ESP');
});
test('untrained activation allows capture firmware but never falls back to the built-in phrase',()=>{
 const p=withCustomWake(voiceProject(),{trained:false}),voice=p.components[0],wake=readWakeProfile(voice);
 assert.equal(voicePlan(wake).length,13);assert.ok(voiceTrainingProblem(wake));
 assert.ok(validateAssembly(p,catalog).some(i=>i.code==='voice-wake-untrained'));
 const bundle=generateFirmware(p,catalog);assert.match(bundle.mainC,/\.custom_wake=true,\.wake_references=wake_references,\.wake_reference_count=0/);
 wake.repeats=4;assert.ok(wakeProfileProblem(wake));wake.repeats=5;wake.commands.push({...wake.commands[0],id:crypto.randomUUID(),phrase:'Другая фраза'});assert.ok(wakeProfileProblem(wake));
 voice.parameters.wakeProfile='broken';assert.throws(()=>parseProject(JSON.stringify(p)),/фразы активации/);
});
test('custom wake tables deploy to P4 and S3 and are disabled for a changed microphone',()=>{
 for(const p of [voiceProject(),microphoneProject('waveshare-esp32-s3-eth','inmp441')]){
  withCustomWake(p);const voice=p.components[0],wake=readWakeProfile(voice),board=catalog.boards.find(b=>b.id===p.boardId);
  assert.equal(validateAssembly(p,catalog).filter(i=>i.severity==='error').length,0);
  const bundle=generateFirmware(p,catalog);assert.match(bundle.mainC,/static const int16_t wake_reference_0/);assert.match(bundle.mainC,/\.wake_reference_count=12/);
  assert.ok(bundle.mainC.includes('"'+voiceRuntimeSignature(voice,p,board)+'"'));
  assert.match(bundle.files['main/idf_component.yml'],/espressif\/esp-sr: "=2\.6\.1"/);
  assert.match(bundle.files['main/idf_component.yml'],/espressif\/esp-dl: "=3\.3\.14"/);
  wake.inputKey='another-source';wake.model.signature=voiceSignature(wake);voice.parameters.wakeProfile=JSON.stringify(wake);
  assert.equal(wakeModelReady(voice,p,board),false);assert.match(generateFirmware(p,catalog).mainC,/\.wake_reference_count=0/);
 }
});
test('built-in wake configuration round-trips with the trained command model',()=>{
 const p=voiceProject(),restored=parseProject(serializeProject(p));
 assert.equal(restored.components[0].parameters.wakeMode,'builtin');
 assert.equal(restored.components[0].parameters.profile,p.components[0].parameters.profile);
 assert.equal(voiceModelReady(readVoiceProfile(restored.components[0])),true);
});

test('recalibration changes the firmware identity without changing recordings or command ports',()=>{
 const p=withCustomWake(voiceProject()),voice=p.components[0],board=catalog.boards.find(b=>b.id===p.boardId);
 const profile=readVoiceProfile(voice),wake=readWakeProfile(voice),before=voiceRuntimeSignature(voice,p,board),graph=structuredClone(p.logic);
 const recordings=structuredClone(profile.samples),signature=profile.model.signature;
 profile.model.streaming=true;voice.parameters.profile=JSON.stringify(profile);
 const calibrated=voiceRuntimeSignature(voice,p,board);assert.notEqual(calibrated,before);
 profile.model.threshold=.2;voice.parameters.profile=JSON.stringify(profile);
 assert.notEqual(voiceRuntimeSignature(voice,p,board),calibrated);
 const updated=voiceRuntimeSignature(voice,p,board);
 wake.model.streaming=true;voice.parameters.wakeProfile=JSON.stringify(wake);
 assert.notEqual(voiceRuntimeSignature(voice,p,board),updated);
 assert.equal(profile.model.signature,signature);assert.deepEqual(profile.samples,recordings);assert.deepEqual(p.logic,graph);
 assert.equal(voiceModelReady(profile),true);assert.deepEqual(parseProject(serializeProject(p)),p);
 profile.model.streaming='yes';assert.ok(voiceProfileProblem(profile));
});
