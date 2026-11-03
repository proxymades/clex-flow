import {readAudioAsset} from '../voice/audio.js';
export const AUDIO_PLAY_MODULE='clex.logic.audio-play';
export function readRecording(node){return readAudioAsset(node.parameters.audio);}
export function recordingIssues(node){
  if(node.moduleId!==AUDIO_PLAY_MODULE)return [];
  try{return readRecording(node)?[]:['Загрузите аудиозапись для воспроизведения.'];}catch(e){return [e.message];}
}
