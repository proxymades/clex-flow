import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {MICROPHONE_BOARDS,microphoneProject} from './microphone-fixture.js';
import {MICROPHONE_MODULES,microphoneSource} from '../src/microphone/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
import {validateAssembly,connectionProblem,addHardware} from '../src/assembly/model.js';
import {validateGraph} from '../src/logic/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {readVoiceProfile,voiceInputMatches,voiceSignature} from '../src/voice/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
test('microphone and voice availability follows the capabilities of every catalog board',()=>{
 for(const board of catalog.boards)for(const id of [...MICROPHONE_MODULES,'clex.hardware.voice','clex.logic.voice'])assert.equal(moduleSupportsBoard(catalog.modules.find(m=>m.id===id),board),MICROPHONE_BOARDS.includes(board.id),board.id+'/'+id);
});
test('analog and digital microphones generate working capture configurations on P4 and both S3 boards',()=>{
 for(const boardId of MICROPHONE_BOARDS)for(const chip of ['max9814','max4466','inmp441']){
  const p=microphoneProject(boardId,chip),board=catalog.boards.find(b=>b.id===boardId),voice=p.components[0];
  assert.deepEqual(validateAssembly(p,catalog).filter(i=>i.severity==='error'),[],boardId+'/'+chip);
  assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[],boardId+'/'+chip);
  assert.ok(voiceInputMatches(readVoiceProfile(voice),p,voice,board));
  const bundle=generateFirmware(p,catalog);
  assert.match(bundle.mainC,new RegExp('\\.mic_kind=CV_MIC_'+(chip==='inmp441'?'I2S':'ADC')));
  assert.ok(bundle.featureRuntimes.includes(board.target==='esp32s3'?'voice-s3':'voice-p4'));
  assert.match(bundle.mainC,/\.commands=2,/);
  assert.deepEqual(parseProject(serializeProject(p)),p);
 }
});
test('microphone wiring blocks 5 V, wrong ADC pins, channel mismatch and occupied controllers',()=>{
 for(const boardId of MICROPHONE_BOARDS){
  const p=microphoneProject(boardId),board=catalog.boards.find(b=>b.id===boardId),mic=p.components.at(-1);
  for(const pin of board.pins.filter(pin=>pin.kind==='power'&&pin.voltage!==3.3))assert.ok(connectionProblem(p,catalog,mic.id,'power',pin.id));
  for(const pin of board.pins.filter(pin=>pin.kind==='gpio'&&!pin.adc))assert.ok(connectionProblem(p,catalog,mic.id,'out',pin.id));
  const duplicate=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.max4466'),catalog);
  assert.ok(validateAssembly(duplicate,catalog).some(i=>i.code==='hardware-resource'));
 }
 const cameraMic=microphoneProject('waveshare-esp32-s3-eth','inmp441');cameraMic.boardSettings.camera='connected';
 assert.ok(validateAssembly(cameraMic,catalog).some(i=>i.severity==='error'));
 const analogCamera=microphoneProject('waveshare-esp32-s3-eth');analogCamera.boardSettings.camera='connected';
 assert.ok(validateAssembly(analogCamera,catalog).some(i=>i.severity==='error'));
 const p=microphoneProject(MICROPHONE_BOARDS[0],'inmp441',{speaker:true}),voice=p.components[0],mic=p.components.at(-1),board=catalog.boards.find(b=>b.id===p.boardId);
 assert.equal(mic.parameters.i2sPort,'1');assert.deepEqual(validateAssembly(p,catalog).filter(i=>i.severity==='error'),[]);
 mic.parameters.i2sPort='0';assert.ok(validateAssembly(p,catalog).some(i=>i.code==='hardware-resource'));mic.parameters.i2sPort='1';
 const gnd=board.pins.find(pin=>pin.kind==='ground');mic.parameters.channel='right';assert.ok(connectionProblem(p,catalog,mic.id,'lr',gnd.id));
 const profile=readVoiceProfile(voice),signature=voiceSignature(profile);assert.equal(voiceInputMatches(profile,p,voice,board),false);assert.equal(voiceSignature(profile),signature);
 assert.equal(microphoneSource(p,voice,board).right,true);
});
