import AudioPreview from '../audio/AudioPreview.jsx';
import MicAudioLines from '../components/MicAudioLines.jsx';
import {isMicrophone,microphoneSource} from '../microphone/model.js';
import {loadActivationAudio,readActivationAudio,readRecognitionAudio} from './audio.js';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {Mic,Plus,Trash2,Play,Square,RefreshCw} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import {desktop} from '../projects/storage.js';
import {formatCount} from '../utils/plural.js';
import {readVoiceProfile,voiceProfileProblem,voiceModelReady,voiceSignature,voicePlan,voiceTrainingProblem,MAX_VOICE_COMMANDS,MAX_VOICE_SAMPLES,voiceDeviceError,voiceSpeakers,voiceInputMatches,readWakeProfile,wakeProfileProblem,wakePhrase,wakeModelReady,voiceRuntimeSignature} from './model.js';

export default function VoiceSettings({component,board,project,busy,onChange,idf}){
  const [open,setOpen]=useState(false),[phrase,setPhrase]=useState(''),[error,setError]=useState(''),[loadingAudio,setLoadingAudio]=useState(false);
  const latest=useRef(component),audioFile=useRef(null),recognitionFile=useRef(null),wakeInput=useRef(null);
  useEffect(()=>{latest.current=component;},[component]);
  const profile=readVoiceProfile(component),speakers=voiceSpeakers(project,component),source=microphoneSource(project,component,board),inputMatches=voiceInputMatches(profile,project,component,board),modelReady=voiceModelReady(profile)&&inputMatches;
  const microphones=project.components.filter(isMicrophone),builtin=(board.peripherals||[]).find(p=>p.driverKey==='es8311-i2s'&&Number.isInteger(p.signals?.din)),audioOutput=Boolean((board.peripherals||[]).some(p=>p.driverKey==='es8311-i2s'&&Number.isInteger(p.signals?.dout)));
  const updateSet=(key,transform)=>{
    const current=latest.current,next=transform(key==='wakeProfile'?readWakeProfile(current):readVoiceProfile(current)),problem=key==='wakeProfile'?wakeProfileProblem(next):voiceProfileProblem(next);
    if(problem){setError(problem);return false;}
    onChange(current.id,{parameters:{...current.parameters,[key]:JSON.stringify(next)}});setError('');return true;
  };
  const update=transform=>updateSet('profile',transform),updateWake=transform=>updateSet('wakeProfile',transform);
  const wake=readWakeProfile(component),wakeReady=wakeModelReady(component,project,board),activationPhrase=wakePhrase(component);
  const renameWake=text=>{
    text=text.trim();if(!text){setError('Введите фразу активации.');return false;}
    return updateWake(p=>{const old=p.commands[0],changed=old?.phrase.toLocaleLowerCase('ru')!==text.toLocaleLowerCase('ru');return {...p,commands:[{id:old?.id||crypto.randomUUID(),phrase:text}],samples:changed?[]:p.samples,model:changed?null:p.model};});
  };
  const add=()=>{
    const text=phrase.trim();if(!text)return;
    if(update(p=>({...p,commands:[...p.commands,{id:crypto.randomUUID(),phrase:text}],model:null})))setPhrase('');
  };
  const rename=(id,text)=>{
    text=text.trim();if(!text)return setError('Фраза не может быть пустой.');
    update(p=>{const old=p.commands.find(c=>c.id===id);const changed=old.phrase.toLocaleLowerCase('ru')!==text.toLocaleLowerCase('ru');return {...p,commands:p.commands.map(c=>c.id===id?{...c,phrase:text}:c),samples:changed?p.samples.filter(s=>s.commandId!==id):p.samples,model:changed?null:p.model};});
  };
  const uploadActivation=async file=>{
    if(!file)return;
    setLoadingAudio(true);setError('');
    try{const asset=await loadActivationAudio(file),current=latest.current;onChange(current.id,{parameters:{...current.parameters,activationSoundType:'recording',activationAudio:JSON.stringify(asset)}});}catch(e){setError(e.message);}finally{setLoadingAudio(false);if(audioFile.current)audioFile.current.value='';}
  };
  let activationAudio;try{activationAudio=readActivationAudio(component);}catch{/* Assembly validation shows the error. */}
  let recognitionAudio;try{recognitionAudio=readRecognitionAudio(component);}catch{/* Assembly validation shows the error. */}
  const uploadRecognition=async file=>{
    if(!file)return;
    setLoadingAudio(true);setError('');
    try{const asset=await loadActivationAudio(file),current=latest.current;onChange(current.id,{parameters:{...current.parameters,recognitionAudio:JSON.stringify(asset)}});}catch(e){setError(e.message);}finally{setLoadingAudio(false);if(recognitionFile.current)recognitionFile.current.value='';}
  };
  const counts=[['repeats','Повторов каждой команды',3,30],['unknownCount','Записей посторонней речи',2,30],['backgroundCount','Записей фона',2,30]];
  const planned=profile.commands.length*profile.repeats+profile.unknownCount+profile.backgroundCount;
  return <div className="voice-settings">
    <label className="field">Микрофон<select aria-label="Микрофон голосового управления" value={component.parameters.microphoneId||''} disabled={busy} onChange={e=>{const selected=microphones.find(m=>m.id===e.target.value);onChange(component.id,{parameters:{...component.parameters,microphoneId:e.target.value,gainDb:selected?(selected.moduleId==='clex.hardware.inmp441'?18:0):24}});}}><option value="">{builtin?'Встроенный микрофон · '+builtin.controller:'Выберите микрофон из монтажа'}</option>{component.parameters.microphoneId&&!microphones.some(m=>m.id===component.parameters.microphoneId)&&<option value={component.parameters.microphoneId} disabled>Выбранный микрофон удалён</option>}{microphones.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    {!builtin&&!microphones.length&&<p className="panel-note">Добавьте MAX9814, MAX4466 или INMP441 в «Монтаже» и подключите его контакты.</p>}
    {!inputMatches&&profile.samples.length>0&&<p className="inspector-warning">Этот набор записан с другого микрофона или подключения. Создайте новый набор записей в настройке распознавания.</p>}
    <label className="field">Усиление микрофона<select aria-label="Усиление микрофона" value={component.parameters.gainDb} disabled={busy} onChange={e=>onChange(component.id,{parameters:{...component.parameters,gainDb:Number(e.target.value)}})}>{Array.from({length:8},(_,i)=>i*6).map(v=><option key={v} value={v}>{v} дБ</option>)}</select></label>
    {component.parameters.microphoneId&&<p className="panel-note">Для внешнего микрофона усиление применяется к записи. Усилитель MAX9814/MAX4466 дополнительно настраивается на самом модуле.</p>}
    <div className="voice-wake-settings">
      <label className="field">Фраза активации<select aria-label="Режим фразы активации" value={component.parameters.wakeMode} disabled={busy} onChange={e=>onChange(component.id,{parameters:{...component.parameters,wakeMode:e.target.value}})}><option value="builtin">Привет ESP</option><option value="custom">Своя фраза</option></select></label>
      {component.parameters.wakeMode==='custom'&&<>
        <label className="field">Своя фраза активации<input ref={wakeInput} key={wake.commands[0]?.phrase||''} aria-label="Своя фраза активации" defaultValue={wake.commands[0]?.phrase||''} placeholder="Введите фразу" maxLength={80} disabled={busy} onBlur={e=>renameWake(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
        <p className="panel-note">Запишите примеры произношения, постороннюю речь и фон. Фраза активации обучается отдельно от команд. Выбирайте фразу длительностью до 2,4 секунды.</p>
        {[['repeats','Повторов фразы активации',5],['unknownCount','Посторонних фраз для активации',3],['backgroundCount','Записей фона для активации',3]].map(([key,label,min])=><label className="field" key={key}>{label}<input key={wake[key]} type="number" aria-label={label} min={min} max={30} defaultValue={wake[key]} disabled={busy} onBlur={e=>{const value=Number(e.target.value);if(!Number.isInteger(value)||value<min||value>30){setError(label+': допустимо от '+min+' до 30.');return;}updateWake(p=>({...p,[key]:value}));}}/></label>)}
        <p className="panel-note">План: {formatCount(wake.repeats+wake.unknownCount+wake.backgroundCount,['запись','записи','записей'])}. Записи команд сохраняются отдельно.</p>
        {!voiceInputMatches(wake,project,component,board)&&wake.samples.length>0&&<p className="inspector-warning">Фраза активации записана с другого микрофона. Создайте новый набор в её настройках.</p>}
        <span className={'badge '+(wakeReady?'green':'purple')}>{wakeReady?'Фраза активации подготовлена':'Фраза активации ещё не обучена'}</span>
        <button className="button secondary" disabled={busy||loadingAudio} onClick={()=>{if(renameWake(wakeInput.current?.value||''))setOpen('wake');}}><MicAudioLines size={16}/>Настроить фразу активации</button>
      </>}
    </div>
    <p className="panel-note">Добавьте команды. Каждая получит отдельный выход в блоке «Голосовые команды».</p>
    <div className="voice-command-list">{profile.commands.map(c=><div className="voice-command-row" key={c.id}><input key={c.phrase} aria-label="Фраза команды" defaultValue={c.phrase} maxLength={80} disabled={busy} onBlur={e=>rename(c.id,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><button className="icon-button" title="Удалить команду" aria-label={'Удалить команду: '+c.phrase} disabled={busy} onClick={()=>update(p=>({...p,commands:p.commands.filter(item=>item.id!==c.id),samples:p.samples.filter(s=>s.commandId!==c.id),model:null}))}><Trash2 size={15}/></button></div>)}</div>
    <label className="field">Новая команда<input aria-label="Новая голосовая команда" placeholder="Введите свою фразу" value={phrase} maxLength={80} disabled={busy||profile.commands.length>=MAX_VOICE_COMMANDS} onChange={e=>setPhrase(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add();}}}/></label>
    <button className="button secondary" disabled={busy||!phrase.trim()||profile.commands.length>=MAX_VOICE_COMMANDS} onClick={add}><Plus size={15}/>Добавить команду</button>
    <p className="panel-note">До {MAX_VOICE_COMMANDS} команд и {MAX_VOICE_SAMPLES} записей на один набор. Для других голосов потребуются дополнительные примеры.</p>
    {counts.map(([key,label,min,max])=><label className="field" key={key}>{label}<input key={profile[key]} type="number" aria-label={label} min={min} max={max} defaultValue={profile[key]} disabled={busy} onBlur={e=>{const value=Number(e.target.value);if(!Number.isInteger(value)||value<min||value>max){setError(label+': допустимо от '+min+' до '+max+'.');return;}update(p=>({...p,[key]:value}));}}/></label>)}
    <p className="panel-note">План: {formatCount(planned,['запись','записи','записей'])}, примерно {Math.ceil(planned*12/60)} мин. Запись каждой фразы запускается отдельно; сеанс можно продолжить позже.</p>
    {planned>MAX_VOICE_SAMPLES&&<p className="inspector-warning">Уменьшите число повторов: в наборе допускается до {MAX_VOICE_SAMPLES} записей.</p>}
    <label className="field">Ожидание команды после обращения, секунд<input key={component.parameters.windowMs} aria-label="Ожидание голосовой команды" type="number" min={5} max={120} defaultValue={component.parameters.windowMs/1000} disabled={busy} onBlur={e=>{const value=Number(e.target.value);if(value>=5&&value<=120)onChange(component.id,{parameters:{...component.parameters,windowMs:Math.round(value*1000)}});}}/></label>
    <p className="panel-note">Одно обращение – одна команда. После распознавания следующая команда требует новой фразы активации. Время ожидания ограничивает паузу после обращения; во время звукового ответа распознавание приостановлено.</p>
    <label className="espnow-check"><input aria-label="Звук после активации" type="checkbox" checked={component.parameters.activationSound} disabled={busy||(!audioOutput&&!component.parameters.activationSound)} onChange={e=>onChange(component.id,{parameters:{...component.parameters,activationSound:e.target.checked,speakerId:component.parameters.speakerId||(speakers.length===1?speakers[0].id:'')}})}/>Звук после активации</label>
    {!audioOutput&&<p className="panel-note">Для этой платы в каталоге пока нет аудиовыхода. Голосовое управление работает без звуковых ответов.</p>}
    {component.parameters.activationSound?<div className="voice-activation-sound">
      <p className="panel-note">{component.parameters.activationVolume>0?'После фразы активации выбранный динамик воспроизведёт звук активации. Приём команд начнётся после окончания звука.':'При громкости 0 звук отключён. Приём команд начнётся сразу после активации.'}</p>
      <label className="field">Звук активации<select aria-label="Звук активации" value={component.parameters.activationSoundType} disabled={busy||loadingAudio} onChange={e=>onChange(component.id,{parameters:{...component.parameters,activationSoundType:e.target.value}})}><option value="tone">Стандартный сигнал</option><option value="recording">Аудиозапись</option></select></label>
      {component.parameters.activationSoundType==='recording'&&<>
        <input className="voice-audio-file" type="file" ref={audioFile} accept=".wav,.mp3,audio/wav,audio/mpeg" aria-label="Файл звука активации" onChange={e=>uploadActivation(e.target.files?.[0])} disabled={busy||loadingAudio}/>
        <button className="button secondary" disabled={busy||loadingAudio} onClick={()=>audioFile.current?.click()}>{loadingAudio?'Подготовка записи…':activationAudio?'Заменить запись':'Загрузить запись'}</button>
        <p className="panel-note">WAV или MP3, до 5 секунд. Запись сохраняется в проекте и включается в прошивку.</p>
        {activationAudio&&<><span className="voice-audio-name">{activationAudio.name} · {(activationAudio.samples/activationAudio.sampleRate).toFixed(1)} сек.</span><AudioPreview source={component.parameters.activationAudio} label="Прослушать звук активации"/><button className="button secondary" disabled={busy||loadingAudio} onClick={()=>onChange(component.id,{parameters:{...component.parameters,activationAudio:''}})}>Удалить запись</button></>}
      </>}
      <label className="field">Громкость звука активации, %<input aria-label="Громкость звука активации" type="range" min={0} max={100} value={component.parameters.activationVolume} disabled={busy} onChange={e=>onChange(component.id,{parameters:{...component.parameters,activationVolume:Number(e.target.value)}})}/><small>{component.parameters.activationVolume}%</small></label>
    </div>:<p className="panel-note">Приём команд начинается сразу после активации.</p>}
    <label className="espnow-check"><input aria-label="Звук после распознавания команды" type="checkbox" checked={Boolean(component.parameters.recognitionSound)} disabled={busy||(!audioOutput&&!component.parameters.recognitionSound)} onChange={e=>onChange(component.id,{parameters:{...component.parameters,recognitionSound:e.target.checked,speakerId:component.parameters.speakerId||(speakers.length===1?speakers[0].id:'')}})}/>Звук после распознавания команды</label>
    {component.parameters.recognitionSound&&<div className="voice-activation-sound">
      <p className="panel-note">Одна запись после любой уверенно распознанной команды, например «Сейчас попробую». Подтверждение выполнения через MQTT подключается отдельно в «Логике».</p>
      <input className="voice-audio-file" type="file" ref={recognitionFile} accept=".wav,.mp3,audio/wav,audio/mpeg" aria-label="Файл ответа на распознанную команду" disabled={busy||loadingAudio} onChange={e=>uploadRecognition(e.target.files?.[0])}/>
      <button className="button secondary" disabled={busy||loadingAudio} onClick={()=>recognitionFile.current?.click()}>{loadingAudio?'Подготовка записи…':recognitionAudio?'Заменить ответ на команду':'Загрузить ответ на команду'}</button>
      <p className="panel-note">WAV или MP3, до 5 секунд. После изменения звука соберите и запишите прошивку.</p>
      {recognitionAudio&&<><span className="voice-audio-name">{recognitionAudio.name} · {(recognitionAudio.samples/recognitionAudio.sampleRate).toFixed(1)} сек.</span><AudioPreview source={component.parameters.recognitionAudio} label="Прослушать ответ на команду"/><button className="button secondary" disabled={busy||loadingAudio} onClick={()=>onChange(component.id,{parameters:{...component.parameters,recognitionAudio:''}})}>Удалить ответ на команду</button></>}
      <label className="field">Громкость ответа на команду, %<input aria-label="Громкость ответа на команду" type="range" min={0} max={100} value={component.parameters.recognitionVolume??85} disabled={busy} onChange={e=>onChange(component.id,{parameters:{...component.parameters,recognitionVolume:Number(e.target.value)}})}/><small>{component.parameters.recognitionVolume??85}%</small></label>
    </div>}
    {(component.parameters.activationSound||component.parameters.recognitionSound)&&<>
      <label className="field">Динамик для голосовых ответов<select aria-label="Динамик для голосовых ответов" value={component.parameters.speakerId} disabled={busy} onChange={e=>onChange(component.id,{parameters:{...component.parameters,speakerId:e.target.value}})}><option value="">Выберите динамик</option>{component.parameters.speakerId&&!speakers.some(s=>s.id===component.parameters.speakerId)&&<option value={component.parameters.speakerId} disabled>Выбранный динамик недоступен</option>}{speakers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {!speakers.length&&<p className="panel-note">Добавьте компонент «Динамик» и выберите встроенный аудиоинтерфейс платы.</p>}
    </>}
    <p className="panel-note">Активация: «{activationPhrase}». Записи берутся с выбранного микрофона. Модель подготавливается в приложении; распознавание работает локально на плате.</p>
    <span className={'badge '+(modelReady?'green':'purple')}>{modelReady?'Модель подготовлена':'Модель ещё не подготовлена'}</span>
    {error&&<p role="alert" className="inspector-warning">{error}</p>}
    <button className="button primary" disabled={busy||loadingAudio||!profile.commands.length||planned>MAX_VOICE_SAMPLES} onClick={()=>setOpen('commands')}><MicAudioLines size={16}/>Настроить распознавание</button>
    {open&&<VoiceDialog key={open} component={component} board={board} profile={open==='wake'?wake:profile} inputKey={source?.key??'missing'} update={open==='wake'?updateWake:update} idf={idf} runtimeSignature={voiceRuntimeSignature(component,project,board)} activationPhrase={activationPhrase} activationReady={wakeReady} onClose={()=>setOpen(false)}/>}
  </div>;
}

function VoiceDialog({component,board,profile,inputKey,update,idf,runtimeSignature,activationPhrase,activationReady,onClose}){
  const wake=profile.purpose==='wake';
  const [tab,setTab]=useState('device'),[operation,setOperation]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[started,setStarted]=useState(false),[countdown,setCountdown]=useState(null),[audio,setAudio]=useState(''),[results,setResults]=useState([]),[nativeReady,setNativeReady]=useState(false),[resetRecords,setResetRecords]=useState(false);
  const current=useRef(null),cancelled=useRef(false),alive=useRef(true),latest=useRef(profile),activationSound=useRef(component.parameters.activationSound&&component.parameters.activationVolume>0),recordUntil=useRef(0),audioUrl=useRef(''),audioPlayer=useRef(null),wakeText=useRef(activationPhrase),commandList=useRef(readVoiceProfile(component).commands);
  useEffect(()=>{wakeText.current=activationPhrase;commandList.current=readVoiceProfile(component).commands;},[activationPhrase,component]);
  useEffect(()=>{latest.current=profile;},[profile]);
  useEffect(()=>{
    alive.current=true;let unlisten;
    if(desktop)listen('voice-progress',event=>{
      const p=event.payload;if(p.id!==current.current)return;
      if(p.state==='countdown'){setCountdown(Number(p.message));setMessage('Приготовьтесь');return;}
      if(p.state==='waiting-for-speech'){recordUntil.current=0;setCountdown(null);}
      if(p.state==='recording'){recordUntil.current=Date.now()+3000;setCountdown(3);}
      if(p.state==='transfer'){recordUntil.current=0;setCountdown(null);}
      if(p.state==='result'){
        const values=Object.fromEntries(p.message.split(' ').slice(1).filter(s=>s.includes('=')).map(s=>s.split('=')));
        if(p.message.startsWith('CLEX_VOICE_COMMAND')){
          const command=commandList.current.find(c=>c.id===values.id);
          setResults(old=>[...old.slice(-19),command?'Распознано: '+command.phrase:'Распознана команда другого набора']);
        }else if(p.message.startsWith('CLEX_VOICE_UNCERTAIN'))setResults(old=>[...old.slice(-19),'Неуверенно. Повторите команду.']);
        else if(p.message.startsWith('CLEX_VOICE_WINDOW'))setMessage('Скажите команду в течение '+(Number(values.remaining_ms||0)/1000)+' сек.');
        else if(p.message.startsWith('CLEX_VOICE_WAITING'))setMessage('Скажите «'+wakeText.current+'»');
        else if(p.message.startsWith('CLEX_VOICE_ACTIVATED')){setResults(old=>[...old.slice(-19),'Активация: «'+wakeText.current+'»']);setMessage(activationSound.current?'Активация обнаружена. После звука активации произнесите команду.':'Активация обнаружена. Произнесите команду.');}
        else if(p.message.startsWith('CLEX_VOICE_ERROR'))setError(voiceDeviceError(p.message));
        else if(p.message.startsWith('CLEX_VOICE_RECOVERED')){setError('');setResults(old=>[...old.slice(-19),'Приём звука восстановлен. Повторите фразу.']);}
      }else setMessage(p.state==='listening'?'Скажите «'+wakeText.current+'»':p.message);
    }).then(fn=>{if(!alive.current)fn();else{unlisten=fn;setNativeReady(true);}}).catch(e=>{if(alive.current)setError('Не удалось подключить журнал записи: '+String(e));});
    return()=>{alive.current=false;unlisten?.();if(current.current)void invoke('idf_cancel',{id:current.current}).catch(()=>{});if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);};
  },[]);
  useEffect(()=>{const timer=setInterval(()=>{if(recordUntil.current)setCountdown(Math.max(0,Math.ceil((recordUntil.current-Date.now())/1000)));},150);return()=>clearInterval(timer);},[]);
  useEffect(()=>{const player=audioPlayer.current;return()=>player?.pause();},[tab]);
  const run=async(name,action)=>{
    cancelled.current=false;const id=crypto.randomUUID();current.current=id;setOperation(name);setError('');
    try{return await action(id);}catch(e){if(alive.current&&!cancelled.current)setError(String(e));return null;}finally{if(alive.current){setOperation('');setCountdown(null);setMessage('');}recordUntil.current=0;current.current=null;}
  };
  const stop=async()=>{cancelled.current=true;recordUntil.current=0;if(current.current)await invoke('idf_cancel',{id:current.current}).catch(()=>{});};
  const plan=voicePlan(profile),task=plan[0],localBusy=Boolean(operation),busy=localBusy||idf?.busy;
  const record=()=>run('record',async id=>{
    if(cancelled.current)return;
    setCountdown(null);setMessage('Ждём начала записи с платы');
    const sample=await invoke('voice_record',{id,port:idf.port,kind:task.kind,gainDb:component.parameters.gainDb});
    if(!alive.current||cancelled.current)return;
    update(p=>{if(task.kind==='command'&&!p.commands.some(c=>c.id===task.commandId))return p;if(p.samples.some(s=>s.id===sample.id))throw Error('Запись полностью совпала с предыдущей. Проверьте микрофон.');return {...p,inputKey,samples:[...p.samples,{...sample,commandId:task.commandId}],model:null};});
  });
  const prepare=()=>run('prepare',async id=>{
    const snapshot=latest.current,signature=voiceSignature(snapshot);
    const model=await invoke('voice_prepare',{id,profile:snapshot,signature});
    if(!alive.current||cancelled.current)return;
    update(p=>{if(voiceSignature(p)!==signature)throw Error('Набор изменился во время подготовки. Запустите подготовку заново.');return {...p,model};});
  });
  const play=sample=>run('audio',async()=>{
    const value=await invoke('voice_audio',{id:sample.id});
    if(!alive.current)return;
    const player=audioPlayer.current;if(!player)return;
    player.pause();
    if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);
    const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));audioUrl.current=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));setAudio(audioUrl.current);
    player.src=audioUrl.current;
    await player.play();
  });
  const beginTest=()=>run('test',async id=>{
    setResults([]);await invoke('voice_test',{id,port:idf.port,signature:runtimeSignature});
  });
  const inputMatches=(profile.inputKey||'')===inputKey,trainProblem=!inputMatches&&profile.samples.length?'Этот набор записан с другого микрофона. Начните новый набор записей.':voiceTrainingProblem(profile);
  const modelReady=voiceModelReady(profile)&&inputMatches;
  return <Modal title={wake?'Настройка фразы активации':'Настройка голосовых команд'} className="voice-modal" busy={Boolean(busy)} onClose={onClose}>
    <nav className="voice-tabs">{[['device','1. Плата'],['record','2. Записи'],['model','3. Модель'],['test','4. Проверка']].map(([value,label])=><button className={tab===value?'active':''} disabled={busy} onClick={()=>setTab(value)} key={value}>{label}</button>)}</nav>
    {!desktop&&<p className="inspector-warning">Запись с платы и подготовка модели доступны в десктопном приложении CLEX Flow.</p>}
    <div className="voice-dialog-body">
    {tab==='device'&&<><h3>Подготовка {board.name}</h3><p>Подключите плату по USB. Внешний микрофон подключается согласно схеме в «Монтаже»; источник выбирается в настройках голосового управления.</p>
      {!idf?.compatible&&<p className="panel-note">Подготовьте инструменты сборки для выбранной платы в настройках приложения.</p>}
      <p>Для первой записи голоса плате нужна прошивка с этим компонентом. Если её ещё нет, используйте кнопки внизу. Запись прошивки заменяет текущую программу платы.</p>
      <p>После обучения модель включается в прошивку всего проекта. Обновите её теми же кнопками. Они используют общие сборку и статус с верхней панелью приложения.</p>
      {idf?.generationError&&<p role="alert" className="inspector-warning">{idf.generationError}</p>}
      <p className="panel-note">Если прошивка для записи уже установлена, можно перейти к записям. Приложение проверит её перед началом.</p></>}
    {tab==='record'&&<>
      {profile.samples.length>0&&<div className="voice-record-reset">{resetRecords?<><p>Очистить записи и подготовленную модель? {wake?'Фраза активации сохранится.':'Список команд сохранится.'}</p><div className="voice-actions"><button className="button secondary" disabled={busy} onClick={()=>{update(p=>({...p,samples:[],model:null,inputKey}));setResetRecords(false);setStarted(false);}}>Очистить записи</button><button className="button secondary" disabled={busy} onClick={()=>setResetRecords(false)}>Отмена</button></div></>:<button className="button secondary" disabled={busy} onClick={()=>setResetRecords(true)}>Начать новый набор записей</button>}</div>}<h3>Ваши записи</h3><p>Сохранено {profile.samples.length}. Осталось {plan.length}. Примерное время оставшейся записи: {Math.ceil(plan.length*12/60)} мин.</p><p>Говорите естественно с обычного расстояния. В каждую запись входит одна показанная фраза. {wake?'Произнесите только фразу активации. Для посторонней речи используйте также обычные команды.':'Фразу активации добавлять не нужно.'}</p>
      {!idf?.port&&<p className="panel-note">Для записи выберите USB-порт внизу окна.</p>}
      {!started?<button className="button primary" disabled={!desktop||!nativeReady||busy||!idf?.port||!plan.length||(!inputMatches&&profile.samples.length>0)} onClick={()=>setStarted(true)}>Начать сеанс записи</button>:task?<div className="voice-record-card"><small>{task.kind==='command'?(wake?'Фраза активации':'Команда'):task.kind==='unknown'?'Посторонняя речь':'Фон'}</small><strong>{task.phrase}</strong><span className="voice-countdown" role="status">{countdown!==null?(message==='Говорите'?'Говорите · ':'Приготовьтесь · ')+countdown:localBusy?message:'Запись начнётся по кнопке'}</span><button className="button primary" disabled={!desktop||!nativeReady||busy||profile.samples.length>=MAX_VOICE_SAMPLES||(!inputMatches&&profile.samples.length>0)} onClick={record}><Mic size={16}/>Записать 3 секунды</button></div>:<p className="voice-success">План записи выполнен. Перейдите к подготовке модели.</p>}
      <div className="voice-recordings">{profile.samples.map((s,i)=><div key={s.id}><span>{i+1}. {s.kind==='command'?profile.commands.find(c=>c.id===s.commandId)?.phrase:s.kind==='unknown'?'Посторонняя речь':'Фон'}</span><button className="icon-button" aria-label={'Прослушать запись '+(i+1)} disabled={!desktop||busy} onClick={()=>play(s)}><Play size={14}/></button><button className="icon-button" aria-label={'Удалить запись '+(i+1)} disabled={busy} onClick={()=>update(p=>({...p,samples:p.samples.filter(item=>item.id!==s.id),model:null}))}><Trash2 size={14}/></button></div>)}</div>
      <audio ref={audioPlayer} controls hidden={!audio} aria-label="Прослушивание выбранной записи"/>
      <p className="panel-note">Можно закрыть мастер и продолжить позже. Звуковые признаки и модель сохраняются в проекте. Аудиофайлы для прослушивания хранятся локально на этом компьютере.</p></>}
    {tab==='model'&&<><h3>Подготовка модели</h3><p>Приложение сравнит отдельные проверочные записи, подберёт порог отклонения и подготовит модель для ваших фраз.</p>{trainProblem&&<p className="panel-note">{trainProblem}</p>}<button className="button primary" disabled={!desktop||busy||Boolean(trainProblem)} onClick={prepare}>Подготовить модель</button>
      {profile.model&&<><p className={modelReady?'voice-success':'inspector-warning'}>{modelReady?(idf?.flashed?'Модель уже в прошивке на плате. Можно перейти к проверке.':idf?.fresh?'Модель включена в собранную прошивку. Запишите её на плату.':'Модель подготовлена. Обновите прошивку проекта кнопками внизу окна.'):!inputMatches?'Модель подготовлена для другого микрофона. Начните новый набор записей.':'Модель требует дополнительных примеров: в проверке обнаружена путаница.'}</p><div className="voice-report">{[['Настройка порогов',profile.model.validation],['Отдельная проверка',profile.model.test]].map(([label,r])=>r&&<div key={label}><strong>{label}</strong><span>{wake?'Фраз активации':'Команд'}: {r.commands} · посторонних записей: {r.total-r.commands} · правильно: {r.correct} · отклонено: {r.rejected} · перепутано: {r.wrong} · {wake?'ложных активаций':'ложных команд'}: {r.falseCommands}</span></div>)}</div></>}
      <p className="panel-note">Проверка относится к записанным голосам и условиям. Неуверенные фразы отклоняются. Другие голоса и шум проверьте отдельными пробами.</p></>}
    {tab==='test'&&<><h3>Проверка на плате</h3><p>После записи обновлённой прошивки запустите проверку. {wake?'Скажите «'+activationPhrase+'». Успешная активация появится в журнале.':component.parameters.activationSound&&component.parameters.activationVolume>0?'Скажите «'+activationPhrase+'», дождитесь окончания звука и произнесите команду.':'Скажите «'+activationPhrase+'» и произнесите команду.'}</p><p>Логика прошивки продолжает выполняться: распознанные команды могут запускать подключённые действия.</p><button className="button primary" disabled={!desktop||!nativeReady||busy||!modelReady||!activationReady||!idf?.port} onClick={beginTest}><Play size={15}/>Начать проверку</button><div className="voice-results" aria-live="polite">{results.map((r,i)=><p key={i}>{r}</p>)}</div></>}
    {message&&<p className="voice-status" role="status">{message}</p>}{error&&<p className="inspector-warning" role="alert">{error}</p>}
    </div><footer className="voice-dialog-footer"><VoiceFirmwareActions idf={idf} busy={busy} modelReady={modelReady}>
      {busy&&<button className="button secondary" onClick={()=>localBusy?stop():idf.cancel()}><Square size={14}/>Остановить</button>}<button className="button secondary" disabled={busy} onClick={onClose}>Закрыть</button>
    </VoiceFirmwareActions></footer>
  </Modal>;
}

function VoiceFirmwareActions({idf,busy,modelReady,children}){
 return <>
  <div className="voice-firmware-row"><div className="voice-port-row"><label className="field">USB-порт<select aria-label="USB-порт голосового компонента" disabled={busy} value={idf?.port||''} onChange={e=>idf.setPort(e.target.value)}><option value="">Выберите порт</option>{idf?.ports?.map(p=><option key={p.path} value={p.path}>{p.path}</option>)}</select></label><button className="button secondary" title="Обновить порты" aria-label="Обновить порты" disabled={!desktop||busy} onClick={()=>idf.refreshPorts()}><RefreshCw size={15}/></button></div>
  <div className="voice-actions"><button className="button secondary" disabled={!desktop||busy||!idf?.compatible||!idf?.fingerprint||!idf?.preview} onClick={()=>idf.startBuild()}>{idf?.fresh?'Собрано':'Собрать прошивку'}</button><button className="button primary" disabled={!desktop||busy||!idf?.fresh||!idf?.port} onClick={()=>idf.startFlash()}>{idf?.flashed?'Записано':'Записать на плату'}</button>{children}</div></div>
  <p className={'voice-firmware-status '+(idf?.error?'voice-error':idf?.flashed?'voice-success':'')} role="status">{idf?.busy?(idf.job?.operation==='flash'?'Записываем прошивку проекта на плату…':'Собираем прошивку проекта…'):idf?.error|| (idf?.flashed?'На плате текущая прошивка проекта. '+(modelReady?'Можно перейти к проверке.':'Можно записывать примеры.') :idf?.fresh?'Проект собран. Запишите прошивку на выбранную плату.':modelReady?'Модель подготовлена. Соберите и запишите прошивку всего проекта.':'Если прошивка для записи голоса уже на плате, можно перейти к записям.')}</p>
 </>;
}
