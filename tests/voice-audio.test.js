import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareActivationAudio,decodeActivationAudio,activationAudioProblem,activationWave,MAX_ACTIVATION_SAMPLES} from '../src/voice/audio.js';
import {voiceProject} from './voice-fixture.js';
import {catalog} from './catalog-fixture.js';
import {validateAssembly} from '../src/assembly/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware} from '../src/firmware/generator.js';

const signal=(size,value=.5)=>Float32Array.from({length:size},()=>value);
test('activation recordings downmix and resample into bounded PCM and playable WAV',()=>{
 const audio=prepareActivationAudio([signal(8000,.5),signal(8000,.25)],8000,'ready.wav'),pcm=decodeActivationAudio(audio);
 assert.equal(audio.samples,16000);assert.equal(audio.sampleRate,16000);assert.equal(activationAudioProblem(audio),null);
 assert.equal(pcm[0],0);assert.equal(pcm.at(-1),0);assert.equal(pcm[1000],Math.round(.375*32767));
 const wave=activationWave(audio),view=new DataView(wave.buffer);
 assert.equal(new TextDecoder().decode(wave.subarray(0,4)),'RIFF');assert.equal(view.getUint32(24,true),16000);
 assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint32(40,true),audio.samples*2);
 assert.equal(view.getInt16(44+2000,true),pcm[1000]);
});
test('overlong, malformed and non-finite recordings are rejected',()=>{
 assert.throws(()=>prepareActivationAudio([signal(MAX_ACTIVATION_SAMPLES+1)],16000,'long.wav'),/не длиннее/);
 assert.throws(()=>prepareActivationAudio([signal(100)],16000,'short.wav'),/слишком короткая/);
 assert.throws(()=>prepareActivationAudio(null,16000,'bad.wav'),/Не удалось/);
 const bad=signal(1600);bad[500]=NaN;assert.throws(()=>prepareActivationAudio([bad],16000,'bad.wav'),/некорректные/);
 const audio=prepareActivationAudio([signal(1600)],16000,'ok.wav');
 for(const patch of [{samples:1601},{samples:MAX_ACTIVATION_SAMPLES+1},{sampleRate:44100},{data:'broken'},{name:'bad\0.wav'}])assert.ok(activationAudioProblem({...audio,...patch}));
});
test('custom activation audio survives project export and is embedded only when selected',()=>{
 const p=voiceProject({speaker:true,activationSound:true}),component=p.components[0];
 component.parameters.activationSoundType='recording';
 assert.ok(validateAssembly(p,catalog).some(i=>i.code==='voice-audio'));
 const audio=prepareActivationAudio([signal(1600)],16000,'ready.wav');component.parameters.activationAudio=JSON.stringify(audio);
 assert.equal(validateAssembly(p,catalog).filter(i=>i.severity==='error').length,0);
 assert.deepEqual(parseProject(serializeProject(p)),p);
 const bundle=generateFirmware(p,catalog);
 assert.match(bundle.mainC,/static const int16_t voice_activation_pcm\[\]/);assert.match(bundle.mainC,/\.activation_pcm=voice_activation_pcm,\.activation_samples=1600/);
 component.parameters.activationSound=false;
 assert.doesNotMatch(generateFirmware(p,catalog).mainC,/static const int16_t voice_activation_pcm/);
 component.parameters.activationSound=true;
 component.parameters.activationSoundType='tone';
 assert.doesNotMatch(generateFirmware(p,catalog).mainC,/static const int16_t voice_activation_pcm/);
 assert.match(generateFirmware(p,catalog).mainC,/\.activation_pcm=NULL,\.activation_samples=0/);
});
