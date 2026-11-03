import test from 'node:test';
import assert from 'node:assert/strict';
import {audioPlayProject} from './audio-play-fixture.js';
import {catalog} from './catalog-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {validateGraph} from '../src/logic/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';

test('recordings play after the connected completion event with shared or independent audio',()=>{
 for(const voice of [true,false]){
  const p=audioPlayProject({voice,customWake:voice}),node=p.logic.nodes.at(-1),tone=p.logic.nodes.at(-2);
  assert.equal(p.logic.edges.find(e=>e.target===node.id).source,tone.id);assert.equal(p.logic.edges.find(e=>e.target===node.id).sourceHandle,'done');
  assert.deepEqual(validateGraph(p,catalog).filter(i=>i.severity==='error'),[]);assert.deepEqual(parseProject(serializeProject(p)),p);
  const bundle=generateFirmware(p,catalog);
  assert.match(bundle.mainC,voice?/clex_voice_play\(/:/clex_audio_0_play_request\(/);
  assert.match(bundle.mainC,voice?/static const int16_t voice_recording_/:/static const int16_t media_recording_/);
  if(voice)assert.doesNotMatch(bundle.mainC,/clex_audio_0_initialize_device/);
  else assert.match(bundle.mainC,/if\(command.pcm\)memcpy/);
  node.parameters.audio='';assert.ok(validateGraph(p,catalog).some(i=>i.code==='audio-recording'));assert.throws(()=>generateFirmware(p,catalog));
  node.parameters.audio='broken';assert.throws(()=>parseProject(JSON.stringify(p)),/аудиозапись/);
 }
});
test('audio playback is offered only on boards supported by the speaker driver',()=>{
 const module=catalog.modules.find(m=>m.id==='clex.logic.audio-play');
 for(const board of catalog.boards)assert.equal(moduleSupportsBoard(module,board),board.target==='esp32p4');
});
