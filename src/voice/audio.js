export const ACTIVATION_RATE=16000;
export const MAX_ACTIVATION_SECONDS=5;
export const MAX_ACTIVATION_SAMPLES=ACTIVATION_RATE*MAX_ACTIVATION_SECONDS;
const MAX_FILE_BYTES=8*1024*1024;
export function activationAudioProblem(audio){
  if(!audio||typeof audio!=='object'||Array.isArray(audio)||audio.version!==1||audio.sampleRate!==ACTIVATION_RATE||typeof audio.name!=='string'||!audio.name.trim()||audio.name.length>80||[...audio.name].some(c=>c.charCodeAt(0)<32)||!Number.isInteger(audio.samples)||audio.samples<800||audio.samples>MAX_ACTIVATION_SAMPLES||typeof audio.data!=='string'||audio.data.length>213336||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio.data))return 'Некорректная аудиозапись.';
  try{if(atob(audio.data).length!==audio.samples*2)return 'Неверный размер аудиозаписи.';}catch{return 'Не удалось прочитать аудиозапись.';}
  return null;
}
export function readActivationAudio(component){return readAudioAsset(component.parameters.activationAudio);}
export function readAudioAsset(text){
  if(text===''||text===undefined)return null;
  try{const audio=JSON.parse(text),problem=activationAudioProblem(audio);if(problem)throw Error(problem);return audio;}catch{throw Error('Повреждена аудиозапись. Загрузите файл повторно.');}
}
export function decodeActivationAudio(audio){
  const problem=activationAudioProblem(audio);if(problem)throw Error(problem);
  const raw=atob(audio.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),pcm=new Int16Array(audio.samples);
  for(let i=0;i<pcm.length;i++)pcm[i]=view.getInt16(i*2,true);
  return pcm;
}
export function prepareActivationAudio(channels,sampleRate,name){
  const length=Array.isArray(channels)&&channels[0]?.length;
  if(!Array.isArray(channels)||channels.length<1||channels.length>8||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||!length||channels.some(c=>!(c instanceof Float32Array)||c.length!==length))throw Error('Не удалось прочитать звуковую дорожку. Используйте WAV или MP3.');
  if(length/sampleRate>MAX_ACTIVATION_SECONDS)throw Error('Запись должна быть не длиннее '+MAX_ACTIVATION_SECONDS+' секунд.');
  const samples=Math.round(length*ACTIVATION_RATE/sampleRate);
  if(samples<800)throw Error('Запись слишком короткая: нужно не менее 0,05 секунды.');
  const bytes=new Uint8Array(samples*2),view=new DataView(bytes.buffer),ramp=Math.min(80,Math.floor(samples/2));
  for(let i=0;i<samples;i++){
    const source=i*sampleRate/ACTIVATION_RATE,a=Math.min(length-1,Math.floor(source)),b=Math.min(length-1,a+1),part=source-a;
    let value=0;
    for(const channel of channels){const v=channel[a]*(1-part)+channel[b]*part;if(!Number.isFinite(v))throw Error('В записи обнаружены некорректные звуковые данные.');value+=v/channels.length;}
    value=Math.max(-1,Math.min(1,value))*Math.min(1,i/ramp,(samples-1-i)/ramp);
    view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {version:1,name:String(name||'Аудиозапись').split(/[\\/]/).at(-1).split('').filter(c=>c.charCodeAt(0)>=32).join('').slice(0,80)||'Аудиозапись',sampleRate:ACTIVATION_RATE,samples,data:btoa(raw)};
}
export async function loadActivationAudio(file){
  if(file.size>MAX_FILE_BYTES)throw Error('Файл должен быть не больше 8 МБ.');
  const Context=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
  if(!Context)throw Error('В этом приложении недоступна подготовка звука.');
  let buffer;
  try{buffer=await new Context(1,1,ACTIVATION_RATE).decodeAudioData(await file.arrayBuffer());}catch{throw Error('Не удалось открыть запись. Используйте WAV или MP3.');}
  return prepareActivationAudio(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),buffer.sampleRate,file.name);
}
export function activationWave(audio){
  const pcm=decodeActivationAudio(audio),bytes=new Uint8Array(44+pcm.length*2),view=new DataView(bytes.buffer);
  const word=(offset,text)=>{for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);};
  word(0,'RIFF');view.setUint32(4,bytes.length-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,ACTIVATION_RATE,true);view.setUint32(28,ACTIVATION_RATE*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++)view.setInt16(44+i*2,pcm[i],true);
  return bytes;
}
