import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {Mic,Plus,Trash2,Play,Square,RefreshCw} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import {desktop} from '../projects/storage.js';
import {formatCount} from '../utils/plural.js';
import {readVoiceProfile,voiceProfileProblem,voiceModelReady,voiceSignature,voicePlan,voiceTrainingProblem,MAX_VOICE_COMMANDS,MAX_VOICE_SAMPLES,voiceDeviceError} from './model.js';

export default function VoiceSettings({component,board,busy,onChange,idf}){
  const [open,setOpen]=useState(false),[phrase,setPhrase]=useState(''),[error,setError]=useState('');
  const latest=useRef(component);
  useEffect(()=>{latest.current=component;},[component]);
  const profile=readVoiceProfile(component);
  const update=transform=>{
    const current=latest.current,next=transform(readVoiceProfile(current)),problem=voiceProfileProblem(next);
    if(problem){setError(problem);return false;}
    onChange(current.id,{parameters:{...current.parameters,profile:JSON.stringify(next)}});setError('');return true;
  };
  const add=()=>{
    const text=phrase.trim();if(!text)return;
    if(update(p=>({...p,commands:[...p.commands,{id:crypto.randomUUID(),phrase:text}],model:null})))setPhrase('');
  };
  const rename=(id,text)=>{
    text=text.trim();if(!text)return setError('Фраза не может быть пустой.');
    update(p=>{const old=p.commands.find(c=>c.id===id);const changed=old.phrase.toLocaleLowerCase('ru')!==text.toLocaleLowerCase('ru');return {...p,commands:p.commands.map(c=>c.id===id?{...c,phrase:text}:c),samples:changed?p.samples.filter(s=>s.commandId!==id):p.samples,model:changed?null:p.model};});
  };
  const counts=[['repeats','Повторов каждой команды',3,30],['unknownCount','Записей посторонней речи',2,30],['backgroundCount','Записей фона',2,30]];
  const planned=profile.commands.length*profile.repeats+profile.unknownCount+profile.backgroundCount;
  return <div className="voice-settings"><p className="panel-note">Добавьте свои короткие фразы. Каждая получит отдельный выход в блоке «Голосовые команды».</p>
    <div className="voice-command-list">{profile.commands.map(c=><div className="voice-command-row" key={c.id}><input key={c.phrase} aria-label="Фраза команды" defaultValue={c.phrase} maxLength={80} disabled={busy} onBlur={e=>rename(c.id,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><button className="icon-button" title="Удалить команду" aria-label={'Удалить команду: '+c.phrase} disabled={busy} onClick={()=>update(p=>({...p,commands:p.commands.filter(item=>item.id!==c.id),samples:p.samples.filter(s=>s.commandId!==c.id),model:null}))}><Trash2 size={15}/></button></div>)}</div>
    <label className="field">Новая команда<input aria-label="Новая голосовая команда" placeholder="Введите свою фразу" value={phrase} maxLength={80} disabled={busy||profile.commands.length>=MAX_VOICE_COMMANDS} onChange={e=>setPhrase(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add();}}}/></label>
    <button className="button secondary" disabled={busy||!phrase.trim()||profile.commands.length>=MAX_VOICE_COMMANDS} onClick={add}><Plus size={15}/>Добавить команду</button>
    <p className="panel-note">До {MAX_VOICE_COMMANDS} команд и {MAX_VOICE_SAMPLES} записей на один набор. Для других голосов потребуются дополнительные примеры.</p>
    {counts.map(([key,label,min,max])=><label className="field" key={key}>{label}<input key={profile[key]} type="number" aria-label={label} min={min} max={max} defaultValue={profile[key]} disabled={busy} onBlur={e=>{const value=Number(e.target.value);if(!Number.isInteger(value)||value<min||value>max){setError(label+': допустимо от '+min+' до '+max+'.');return;}update(p=>({...p,[key]:value}));}}/></label>)}
    <p className="panel-note">План: {formatCount(planned,['запись','записи','записей'])}, примерно {Math.ceil(planned*12/60)} мин. Запись каждой фразы запускается отдельно; сеанс можно продолжить позже.</p>
    {planned>MAX_VOICE_SAMPLES&&<p className="inspector-warning">Уменьшите число повторов: в наборе допускается до {MAX_VOICE_SAMPLES} записей.</p>}
    <label className="field">Окно команд, секунд<input key={component.parameters.windowMs} aria-label="Окно голосовых команд" type="number" min={5} max={120} defaultValue={component.parameters.windowMs/1000} disabled={busy} onBlur={e=>{const value=Number(e.target.value);if(value>=5&&value<=120)onChange(component.id,{parameters:{...component.parameters,windowMs:Math.round(value*1000)}});}}/></label>
    <label className="field">Громкость сигнала, %<input aria-label="Громкость голосового сигнала" type="range" min={0} max={100} value={component.parameters.volume} disabled={busy} onChange={e=>onChange(component.id,{parameters:{...component.parameters,volume:Number(e.target.value)}})}/><small>{component.parameters.volume}%</small></label>
    <label className="field">Усиление микрофона<select aria-label="Усиление микрофона" value={component.parameters.gainDb} disabled={busy} onChange={e=>onChange(component.id,{parameters:{...component.parameters,gainDb:Number(e.target.value)}})}>{Array.from({length:8},(_,i)=>i*6).map(v=><option key={v} value={v}>{v} дБ</option>)}</select></label>
    <p className="panel-note">Активация: «Привет ESP». Записи берутся с микрофона платы, модель подготавливается в приложении на компьютере. После прошивки плата работает автономно.</p>
    <span className={'badge '+(voiceModelReady(profile)?'green':'purple')}>{voiceModelReady(profile)?'Модель подготовлена':'Модель ещё не подготовлена'}</span>
    {error&&<p role="alert" className="inspector-warning">{error}</p>}
    <button className="button primary" disabled={busy||!profile.commands.length||planned>MAX_VOICE_SAMPLES} onClick={()=>setOpen(true)}><Mic size={16}/>Настроить распознавание</button>
    {open&&<VoiceDialog component={component} board={board} profile={profile} update={update} idf={idf} onClose={()=>setOpen(false)}/>}
  </div>;
}

function VoiceDialog({component,board,profile,update,idf,onClose}){
  const [tab,setTab]=useState('device'),[operation,setOperation]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[started,setStarted]=useState(false),[countdown,setCountdown]=useState(null),[audio,setAudio]=useState(''),[results,setResults]=useState([]),[nativeReady,setNativeReady]=useState(false);
  const current=useRef(null),cancelled=useRef(false),alive=useRef(true),latest=useRef(profile),recordUntil=useRef(0),audioUrl=useRef('');
  useEffect(()=>{latest.current=profile;},[profile]);
  useEffect(()=>{
    alive.current=true;let unlisten;
    if(desktop)listen('voice-progress',event=>{
      const p=event.payload;if(p.id!==current.current)return;
      if(p.state==='countdown'){setCountdown(Number(p.message));setMessage('Приготовьтесь');return;}
      if(p.state==='recording'){recordUntil.current=Date.now()+3000;setCountdown(3);}
      if(p.state==='transfer'){recordUntil.current=0;setCountdown(null);}
      if(p.state==='result'){
        const values=Object.fromEntries(p.message.split(' ').slice(1).filter(s=>s.includes('=')).map(s=>s.split('=')));
        if(p.message.startsWith('CLEX_VOICE_COMMAND')){
          const command=latest.current.commands.find(c=>c.id===values.id);
          setResults(old=>[...old.slice(-19),command?'Распознано: '+command.phrase:'Распознана команда другого набора']);
        }else if(p.message.startsWith('CLEX_VOICE_UNCERTAIN'))setResults(old=>[...old.slice(-19),'Неуверенно. Повторите команду.']);
        else if(p.message.startsWith('CLEX_VOICE_WINDOW'))setMessage('Приём команд: '+(Number(values.remaining_ms||0)/1000)+' сек.');
        else if(p.message.startsWith('CLEX_VOICE_WAITING'))setMessage('Скажите «Привет ESP»');
        else if(p.message.startsWith('CLEX_VOICE_ACTIVATED'))setMessage('Активация обнаружена. После сигнала произнесите команду.');
        else if(p.message.startsWith('CLEX_VOICE_ERROR'))setError(voiceDeviceError(p.message));
      }else setMessage(p.message);
    }).then(fn=>{if(!alive.current)fn();else{unlisten=fn;setNativeReady(true);}}).catch(e=>{if(alive.current)setError('Не удалось подключить журнал записи: '+String(e));});
    return()=>{alive.current=false;unlisten?.();if(current.current)void invoke('idf_cancel',{id:current.current}).catch(()=>{});if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);};
  },[]);
  useEffect(()=>{const timer=setInterval(()=>{if(recordUntil.current)setCountdown(Math.max(0,Math.ceil((recordUntil.current-Date.now())/1000)));},150);return()=>clearInterval(timer);},[]);
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
    update(p=>{if(task.kind==='command'&&!p.commands.some(c=>c.id===task.commandId))return p;if(p.samples.some(s=>s.id===sample.id))throw Error('Запись полностью совпала с предыдущей. Проверьте микрофон.');return {...p,samples:[...p.samples,{...sample,commandId:task.commandId}],model:null};});
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
    if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);
    const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));audioUrl.current=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));setAudio(audioUrl.current);
  });
  const beginTest=()=>run('test',async id=>{
    setResults([]);await invoke('voice_test',{id,port:idf.port,signature:voiceSignature(latest.current)});
  });
  const trainProblem=voiceTrainingProblem(profile);
  return <Modal title="Настройка голосовых команд" className="voice-modal" busy={Boolean(busy)} onClose={onClose}>
    <nav className="voice-tabs">{[['device','1. Плата'],['record','2. Записи'],['model','3. Модель'],['test','4. Проверка']].map(([value,label])=><button className={tab===value?'active':''} disabled={busy} onClick={()=>setTab(value)} key={value}>{label}</button>)}</nav>
    {!desktop&&<p className="inspector-warning">Запись с платы и подготовка модели доступны в десктопном приложении CLEX Flow.</p>}
    <div className="voice-dialog-body">
    {tab==='device'&&<><h3>Подготовка {board.name}</h3><p>Микрофон и кодек ES8311 используются через встроенный аудиоинтерфейс. Подключите плату по USB.</p>
      <div className="voice-port-row"><label className="field">USB-порт<select aria-label="USB-порт голосового компонента" disabled={busy} value={idf?.port||''} onChange={e=>idf.setPort(e.target.value)}><option value="">Выберите порт</option>{idf?.ports?.map(p=><option key={p.path} value={p.path}>{p.path}</option>)}</select></label><button className="button secondary" disabled={!desktop||busy} onClick={()=>idf.refreshPorts()}><RefreshCw size={15}/>Обновить порты</button></div>
      {!idf?.compatible&&<p className="panel-note">Подготовьте инструменты сборки для выбранной платы в настройках приложения.</p>}
      <p>Сначала соберите прошивку с этим компонентом и запишите её на выбранную плату. Она заменит текущую программу. После подготовки модели сборку и запись нужно повторить.</p>
      <div className="voice-actions"><button className="button secondary" disabled={!desktop||busy||!idf?.compatible||!idf?.fingerprint||!idf?.preview} onClick={()=>idf.startBuild()}>Собрать прошивку</button><button className="button primary" disabled={!desktop||busy||!idf?.fresh||!idf?.port} onClick={()=>idf.startFlash()}>Записать на плату</button></div>
      <div className="voice-build-status" role="status">{idf?.busy?<p>{idf.events?.at(-1)?.text||'Выполняется операция с платой…'}</p>:idf?.error?<p className="voice-error">{idf.error}</p>:idf?.fresh?<p className="voice-success">Прошивка собрана. {idf?.port?'Можно записать её на выбранную плату.':'Выберите USB-порт для записи на плату.'}</p>:<p>Сначала соберите прошивку, затем запишите её на плату.</p>}</div>
      {idf?.generationError&&<p role="alert" className="inspector-warning">{idf.generationError}</p>}
      <p className="panel-note">Если прошивка для записи уже установлена, можно перейти к записям. Приложение проверит её перед началом.</p></>}
    {tab==='record'&&<><h3>Ваши записи</h3><p>Сохранено {profile.samples.length}. Осталось {plan.length}. Примерное время оставшейся записи: {Math.ceil(plan.length*12/60)} мин.</p><p>Говорите естественно с обычного расстояния. В каждую запись входит одна показанная фраза. «Привет ESP» добавлять не нужно.</p>
      {!idf?.port&&<p className="panel-note">Для записи выберите USB-порт на вкладке «Плата».</p>}
      {!started?<button className="button primary" disabled={!desktop||!nativeReady||busy||!idf?.port||!plan.length} onClick={()=>setStarted(true)}>Начать сеанс записи</button>:task?<div className="voice-record-card"><small>{task.kind==='command'?'Команда':task.kind==='unknown'?'Посторонняя речь':'Фон'}</small><strong>{task.phrase}</strong><span className="voice-countdown" role="status">{countdown!==null?(message==='Говорите'?'Говорите · ':'Приготовьтесь · ')+countdown:localBusy?message:'Запись начнётся по кнопке'}</span><button className="button primary" disabled={!desktop||!nativeReady||busy||profile.samples.length>=MAX_VOICE_SAMPLES} onClick={record}><Mic size={16}/>Записать 3 секунды</button></div>:<p className="voice-success">План записи выполнен. Перейдите к подготовке модели.</p>}
      <div className="voice-recordings">{profile.samples.map((s,i)=><div key={s.id}><span>{i+1}. {s.kind==='command'?profile.commands.find(c=>c.id===s.commandId)?.phrase:s.kind==='unknown'?'Посторонняя речь':'Фон'}</span><button className="icon-button" aria-label={'Прослушать запись '+(i+1)} disabled={!desktop||busy} onClick={()=>play(s)}><Play size={14}/></button><button className="icon-button" aria-label={'Удалить запись '+(i+1)} disabled={busy} onClick={()=>update(p=>({...p,samples:p.samples.filter(item=>item.id!==s.id),model:null}))}><Trash2 size={14}/></button></div>)}</div>
      {audio&&<audio controls src={audio}/>}
      <p className="panel-note">Можно закрыть мастер и продолжить позже. Звуковые признаки и модель сохраняются в проекте. Аудиофайлы для прослушивания хранятся локально на этом компьютере.</p></>}
    {tab==='model'&&<><h3>Подготовка модели</h3><p>Приложение сравнит отдельные проверочные записи, подберёт порог отклонения и подготовит модель для ваших фраз.</p>{trainProblem&&<p className="panel-note">{trainProblem}</p>}<button className="button primary" disabled={!desktop||busy||Boolean(trainProblem)} onClick={prepare}>Подготовить модель</button>
      {profile.model&&<><p className={voiceModelReady(profile)?'voice-success':'inspector-warning'}>{voiceModelReady(profile)?'Модель подготовлена. Соберите и запишите обновлённую прошивку.':'Модель требует дополнительных примеров: в проверке обнаружена путаница.'}</p><div className="voice-report">{[['Настройка порогов',profile.model.validation],['Отдельная проверка',profile.model.test]].map(([label,r])=>r&&<div key={label}><strong>{label}</strong><span>Команд: {r.commands} · посторонних записей: {r.total-r.commands} · правильно: {r.correct} · отклонено: {r.rejected} · перепутано: {r.wrong} · ложных команд: {r.falseCommands}</span></div>)}</div></>}
      <p className="panel-note">Проверка относится к записанным голосам и условиям. Неуверенные фразы отклоняются. Другие голоса и шум проверьте отдельными пробами.</p></>}
    {tab==='test'&&<><h3>Проверка на плате</h3><p>После записи обновлённой прошивки запустите проверку. Скажите «Привет ESP», дождитесь сигнала и произнесите одну из своих команд.</p><p>Логика прошивки продолжает выполняться: распознанные команды могут запускать подключённые действия.</p><button className="button primary" disabled={!desktop||!nativeReady||busy||!voiceModelReady(profile)||!idf?.port} onClick={beginTest}><Play size={15}/>Начать проверку</button><div className="voice-results" aria-live="polite">{results.map((r,i)=><p key={i}>{r}</p>)}</div></>}
    {message&&<p className="voice-status" role="status">{message}</p>}{error&&<p className="inspector-warning" role="alert">{error}</p>}
    </div><footer>{busy&&<button className="button secondary" onClick={()=>localBusy?stop():idf.cancel()}><Square size={14}/>Остановить</button>}<button className="button secondary" disabled={busy} onClick={onClose}>Закрыть</button></footer>
  </Modal>;
}
