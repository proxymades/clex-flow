import {microphoneSource,voiceSupported} from '../microphone/model.js';
import {readActivationAudio} from './audio.js';
export const VOICE_MODULE='clex.hardware.voice';
export const VOICE_LOGIC='clex.logic.voice';
export const SPEAKER_MODULE='clex.hardware.audio';
export function voiceInputMatches(profile,project,voice,board){return (profile.inputKey||'')===(microphoneSource(project,voice,board)?.key??'missing');}
export function voiceSpeakers(project,voice){
  return project.components.filter(c=>c.moduleId===SPEAKER_MODULE&&c.parameters.interfaceId&&c.parameters.interfaceId===voice.parameters.interfaceId);
}
export function sharedVoiceAudio(project,speaker){
  return speaker.moduleId===SPEAKER_MODULE?project.components.find(c=>c.moduleId===VOICE_MODULE&&c.parameters.interfaceId&&c.parameters.interfaceId===speaker.parameters.interfaceId):null;
}
export const MAX_VOICE_COMMANDS=32;
export const MAX_VOICE_SAMPLES=128;
export const VOICE_FRAMES=119;
export const VOICE_COEFFS=12;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const emptyVoiceProfile=()=>({version:1,commands:[],samples:[],repeats:5,unknownCount:3,backgroundCount:3,model:null});
export const emptyWakeProfile=()=>({...emptyVoiceProfile(),purpose:'wake',unknownCount:5});
export function readWakeProfile(component){
  if(!component?.parameters?.wakeProfile)return emptyWakeProfile();
  try{return JSON.parse(component.parameters.wakeProfile);}catch{throw Error('Повреждены записи фразы активации.');}
}
export function wakePhrase(component){return component.parameters.wakeMode==='custom'?readWakeProfile(component).commands[0]?.phrase||'свою фразу активации':'Привет ESP';}
export function wakeProfileProblem(profile){return voiceProfileProblem(profile)||(profile.purpose!=='wake'||profile.commands.length>1?'Укажите одну фразу активации.':null);}
export function wakeModelReady(component,project,board){
  if(component.parameters.wakeMode!=='custom')return true;
  const profile=readWakeProfile(component);
  return !wakeProfileProblem(profile)&&voiceModelReady(profile)&&voiceInputMatches(profile,project,component,board);
}
function signatureHash(text){let value=2166136261;for(let i=0;i<text.length;i++)value=Math.imul(value^text.charCodeAt(i),16777619);return (value>>>0).toString(16).padStart(8,'0');}
export function voiceRuntimeSignature(component,project,board){
  const profile=readVoiceProfile(component),commands=voiceModelReady(profile)&&voiceInputMatches(profile,project,component,board)?voiceSignature(profile):'none';
  return component.parameters.wakeMode==='custom'?signatureHash(JSON.stringify([commands,'wake',wakeModelReady(component,project,board)?voiceSignature(readWakeProfile(component)):'none'])):commands;
}
export function readVoiceProfile(component){
  if(!component?.parameters?.profile)return emptyVoiceProfile();
  try{return JSON.parse(component.parameters.profile);}catch{throw Error('Повреждены настройки голосовых команд.');}
}
export function voiceSignature(profile){
  const text=JSON.stringify([profile.commands.map(c=>[c.id,c.phrase.trim().toLocaleLowerCase('ru')]),profile.samples.map(s=>[s.id,s.commandId,s.kind,s.frames,s.data,...(s.scale!==undefined&&s.scale!==4096?[s.scale]:[]) ]),...(profile.inputKey?[profile.inputKey]:[]),...(profile.purpose?[profile.purpose]:[])]);
  return signatureHash(text);
}
export function decodeVoiceFeatures(sample){
  const raw=atob(sample.data),values=[];
  for(let i=0;i<raw.length;i+=2){let value=raw.charCodeAt(i)|(raw.charCodeAt(i+1)<<8);if(value>=32768)value-=65536;values.push(value);}
  return values;
}
export function voiceProfileProblem(profile){
  if(!object(profile)||profile.version!==1||!Array.isArray(profile.commands)||profile.commands.length>MAX_VOICE_COMMANDS||!Array.isArray(profile.samples)||profile.samples.length>MAX_VOICE_SAMPLES)return 'Некорректный набор голосовых команд.';
  if(!Number.isInteger(profile.repeats)||profile.repeats<3||profile.repeats>30||!Number.isInteger(profile.unknownCount)||profile.unknownCount<2||profile.unknownCount>30||!Number.isInteger(profile.backgroundCount)||profile.backgroundCount<2||profile.backgroundCount>30)return 'Проверьте количество повторов и фоновых записей.';
  if(profile.inputKey!==undefined&&(typeof profile.inputKey!=='string'||profile.inputKey.length>512))return 'Некорректный источник голосовых записей.';
  if(profile.purpose!==undefined&&profile.purpose!=='wake')return 'Некорректное назначение голосовой модели.';
  if(profile.purpose==='wake'&&(profile.commands.length>1||profile.repeats<5||profile.unknownCount<3||profile.backgroundCount<3))return 'Для фразы активации нужны не менее пяти повторов и по три записи посторонней речи и фона.';
  const ids=new Set(),phrases=new Set();
  for(const c of profile.commands){
    const phrase=object(c)&&typeof c.phrase==='string'?c.phrase.trim().toLocaleLowerCase('ru'):'';
    if(!object(c)||!UUID.test(c.id)||ids.has(c.id)||!phrase||phrase.length>80||[...phrase].some(char=>char.charCodeAt(0)<32)||phrases.has(phrase))return 'Команды должны иметь разные непустые фразы длиной до 80 символов.';
    ids.add(c.id);phrases.add(phrase);
  }
  const sampleIds=new Set();
  for(const sample of profile.samples){
    if(!object(sample)||!HASH.test(sample.id)||sampleIds.has(sample.id)||!['command','unknown','background'].includes(sample.kind)||sample.kind==='command'&&!ids.has(sample.commandId)||sample.kind!=='command'&&sample.commandId!==null||!Number.isInteger(sample.frames)||sample.frames<1||sample.frames>VOICE_FRAMES||sample.scale!==undefined&&![512,1024,2048,4096].includes(sample.scale)||typeof sample.data!=='string'||sample.data.length>3808||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(sample.data)||!object(sample.quality)||!['rms','peak','clipped'].every(key=>Number.isFinite(sample.quality[key])&&sample.quality[key]>=0))return 'Некорректная запись голосовой команды.';
    try{if(decodeVoiceFeatures(sample).length!==sample.frames*VOICE_COEFFS)return 'Неверный размер звуковых признаков.';}catch{return 'Повреждены звуковые признаки.';}
    sampleIds.add(sample.id);
  }
  if(profile.model!==null&&profile.model!==undefined){
    const model=profile.model;
    if(!object(model)||model.version!==1||typeof model.signature!=='string'||!/^[0-9a-f]{8}$/.test(model.signature)||!Array.isArray(model.referenceIds)||model.referenceIds.length<1||new Set(model.referenceIds).size!==model.referenceIds.length||model.referenceIds.some(id=>!sampleIds.has(id))||!Number.isFinite(model.threshold)||model.threshold<=0||model.threshold>2||!Number.isFinite(model.ratio)||model.ratio<=0||model.ratio>=1||typeof model.ready!=='boolean'||![model.validation,model.test].every(report=>object(report)&&['total','commands','correct','rejected','wrong','falseCommands'].every(key=>Number.isInteger(report[key])&&report[key]>=0)&&report.total>=report.commands&&report.commands===report.correct+report.rejected+report.wrong&&report.falseCommands<=report.total-report.commands))return 'Некорректная модель голосовых команд.';
  }
  return null;
}
export function voiceModelReady(profile){return Boolean(profile.model?.ready&&profile.model.signature===voiceSignature(profile));}
export function voicePorts(component){
  if(!component)return [];
  try{return readVoiceProfile(component).commands.map(command=>({id:'command_'+command.id.replaceAll('-',''),name:command.phrase,type:'event',description:'Срабатывает при уверенном распознавании этой команды.'}));}catch{return [];}
}
export function voicePlan(profile){
  const tasks=[];
  for(let repeat=0;repeat<profile.repeats;repeat++)for(const command of profile.commands){
    if(profile.samples.filter(s=>s.kind==='command'&&s.commandId===command.id).length<=repeat)tasks.push({kind:'command',commandId:command.id,phrase:command.phrase});
  }
  for(const [kind,count,phrase]of [['unknown',profile.unknownCount,profile.purpose==='wake'?'Произнесите другую фразу, например одну из команд':'Произнесите фразу, которой нет в списке команд'],['background',profile.backgroundCount,'Помолчите: записываем фон комнаты']]){
    for(let i=profile.samples.filter(s=>s.kind===kind).length;i<count;i++)tasks.push({kind,commandId:null,phrase});
  }
  return tasks;
}
export function voiceTrainingProblem(profile){
  const problem=voiceProfileProblem(profile);if(problem)return problem;
  const wake=profile.purpose==='wake';
  if(!profile.commands.length)return wake?'Введите фразу активации.':'Добавьте хотя бы одну свою команду.';
  for(const command of profile.commands)if(profile.samples.filter(s=>s.commandId===command.id&&s.kind==='command').length<(wake?5:3))return 'Запишите не менее '+(wake?'пяти':'трёх')+' примеров '+(wake?'фразы активации':'команды')+' «'+command.phrase+'».';
  for(const [kind,name]of [['unknown','посторонней речи'],['background','фона']])if(profile.samples.filter(s=>s.kind===kind).length<(wake?3:2))return 'Нужны хотя бы '+(wake?'три':'две')+' записи '+name+'.';
  return null;
}
export function voiceIssues(project,catalog){
  const voices=project.components.filter(c=>c.moduleId===VOICE_MODULE);
  if(voices.length>1)return [{severity:'error',code:'voice-duplicate',message:'Один аудиоинтерфейс поддерживает один голосовой компонент.'}];
  return voices.flatMap(component=>{
    const board=catalog?.boards.find(b=>b.id===project.boardId),microphone=microphoneSource(project,component,board);
    if(catalog&&!voiceSupported(board))return [{severity:'error',code:'voice-board',componentId:component.id,message:'Для голосового управления нужна поддерживаемая ESP32-P4 или ESP32-S3 с PSRAM.'}];
    if(catalog&&!microphone)return [{severity:'error',code:'voice-microphone',componentId:component.id,message:'Выберите поддерживаемый микрофон в настройках голосового управления.'}];
    if(!Number.isInteger(component.parameters.gainDb)||component.parameters.gainDb%6!==0||!Number.isInteger(component.parameters.activationVolume)||typeof component.parameters.activationSound!=='boolean'||typeof component.parameters.speakerId!=='string'||!['tone','recording'].includes(component.parameters.activationSoundType)||typeof component.parameters.activationAudio!=='string'||!Number.isInteger(component.parameters.windowMs))return [{severity:'error',code:'voice-settings',componentId:component.id,message:'Некорректные настройки микрофона и окна команд.'}];
    if(component.parameters.activationSound&&!voiceSpeakers(project,component).some(c=>c.id===component.parameters.speakerId))return [{severity:'error',code:'voice-speaker',componentId:component.id,message:'Для звука после активации выберите компонент «Динамик», подключённый к встроенному аудиоинтерфейсу платы, или отключите звук.'}];
    let activationAudio;try{activationAudio=readActivationAudio(component);}catch(e){return [{severity:'error',code:'voice-audio',componentId:component.id,message:e.message}];}
    if(component.parameters.activationSound&&component.parameters.activationSoundType==='recording'&&!activationAudio)return [{severity:'error',code:'voice-audio',componentId:component.id,message:'Загрузите аудиозапись для звука после активации или выберите «Стандартный сигнал».'}];
    let profile;try{profile=readVoiceProfile(component);}catch(e){return [{severity:'error',code:'voice-profile',componentId:component.id,message:e.message}];}
    const problem=voiceProfileProblem(profile);
    if(problem)return [{severity:'error',code:'voice-profile',componentId:component.id,message:component.name+': '+problem}];
    if(!['builtin','custom'].includes(component.parameters.wakeMode))return [{severity:'error',code:'voice-wake',componentId:component.id,message:'Выберите фразу активации.'}];
    let wake;try{wake=readWakeProfile(component);}catch(e){return [{severity:'error',code:'voice-wake',componentId:component.id,message:e.message}];}
    const wakeProblem=wakeProfileProblem(wake);if(wakeProblem)return [{severity:'error',code:'voice-wake',componentId:component.id,message:wakeProblem}];
    const issues=[];
    if(!voiceModelReady(profile)||(catalog&&!voiceInputMatches(profile,project,component,board)))issues.push({severity:'warning',code:'voice-untrained',componentId:component.id,message:component.name+': подготовьте модель команд в настройках компонента. До этого прошивка поддерживает запись голоса.'});
    if(component.parameters.wakeMode==='custom'&&(!voiceModelReady(wake)||(catalog&&!voiceInputMatches(wake,project,component,board))))issues.push({severity:'warning',code:'voice-wake-untrained',componentId:component.id,message:component.name+': подготовьте модель фразы активации. До этого распознавание активации отключено.'});
    return issues;
  });
}

export function voiceDeviceError(line){
  const code=line.replace(/^CLEX_VOICE_ERROR\s*/, '').trim();
  return ({audio_busy:'Аудиоинтерфейс занят. Дождитесь окончания сигнала и повторите запись.',model_not_ready:'На плате нет подготовленной модели. Соберите и запишите обновлённую прошивку.',invalid_gain:'Не удалось настроить усиление микрофона. Перезапустите плату и повторите запись.',microphone_read:'Ошибка чтения микрофона. Проверьте аудиоинтерфейс и перезапустите плату.',microphone_timeout:'Микрофон не передал запись. Перезапустите плату и повторите попытку.',microphone_restart:'Перезапустите плату перед следующей записью.',no_memory:'Недостаточно памяти для аудиозаписи.',capture_mismatch:'Ошибка аудиобуфера. Перезапустите плату.'})[code]||'Ошибка голосового компонента: '+code;
}
