import {useEffect,useState} from 'react';
import {Plus,Trash2,KeyRound,Copy,Check} from 'lucide-react';
import {readPeers,newKey,keyValid,MAX_PEERS} from './model.js';
function CopyLmk({value}){
 const [copied,setCopied]=useState(''),[error,setError]=useState('');
 const copy=async()=>{
  setCopied('');setError('');
  try{await navigator.clipboard.writeText(value);setCopied(value);}
  catch{setError('Не удалось скопировать LMK. Выделите и скопируйте ключ вручную.');}
 };
 return <div className="espnow-copy-key"><button className="button secondary" disabled={!keyValid(value)} onClick={copy}>{copied===value&&value?<Check size={14}/>:<Copy size={14}/>}Скопировать LMK</button>{copied===value&&value&&<p className="panel-note" role="status">LMK скопирован</p>}{error&&<p className="inspector-warning" role="alert">{error}</p>}</div>;
}
export default function EspNowSettings({component,busy,onChange,events=[],idf}){
 const [showKeys,setShowKeys]=useState(false),[copied,setCopied]=useState(''),[copyError,setCopyError]=useState(null);
 const p=component.parameters,peers=readPeers(component).map(peer=>({...peer,encrypted:Boolean(p.encryption&&peer.encrypted)}));
 const set=patch=>onChange(component.id,{parameters:{...p,encryption:true,pmk:keyValid(p.pmk)?p.pmk:newKey(),peers:JSON.stringify(peers),...patch}});
 useEffect(()=>{
  if(busy||(keyValid(p.pmk)&&p.encryption!==false))return;
  const parameters={...p,pmk:keyValid(p.pmk)?p.pmk:newKey()};
  // Preserve the effective plaintext mode of projects saved with the old global switch off.
  if(p.encryption===false){parameters.encryption=true;parameters.peers=JSON.stringify(readPeers({parameters:p}).map(peer=>({...peer,encrypted:false})));}
  const timer=setTimeout(()=>onChange(component.id,{parameters}),0);
  return()=>clearTimeout(timer);
 },[component.id,p,busy,onChange]);
 const update=(id,patch)=>set({peers:JSON.stringify(peers.map(peer=>peer.id===id?{...peer,...patch}:peer))});
 const monitorEvents=!idf||(idf.job?.operation==='monitor'&&idf.job.port===idf.port)?events:[];
 const log=monitorEvents.filter(e=>e.operation==='monitor'&&e.stream==='stdout').map(e=>e.text).join('');
 const loggedMac=[...log.matchAll(/CLEX_ESPNOW[^\r\n]*component=([^\s]+) mac=((?:[\da-f]{2}:){5}[\da-f]{2})/gi)].filter(match=>match[1]===component.id).at(-1)?.[2];
 const mac=idf?.deviceMac?.mac||loggedMac;
 const copyMac=async()=>{
  if(!mac)return;
  setCopied('');setCopyError(null);
  try{await navigator.clipboard.writeText(mac);setCopied(mac);}
  catch{setCopyError({mac,message:'Не удалось скопировать MAC. Выделите и скопируйте адрес вручную.'});}
 };
 return <div className="espnow-settings"><div className="espnow-mac"><span>MAC этой платы</span><code>{mac||(idf?.readingMac?'Определяем MAC…':'Не определен')}</code></div><button className="button secondary espnow-copy-mac" disabled={!mac} onClick={copyMac}>{copied===mac&&mac?<Check size={14}/>:<Copy size={14}/>}Скопировать MAC</button>{copied===mac&&mac&&<p className="panel-note" role="status">MAC скопирован</p>}{copyError&&copyError.mac===mac&&<p className="inspector-warning" role="alert">{copyError.message}</p>}{idf?.macError?<p className="inspector-warning" role="alert">{idf.macError} Переподключите плату для повторного чтения.</p>:<p className="panel-note">{!idf?.desktop?'MAC определится при подключении платы в приложении CLEX Flow.':!idf?.compatible?'Подготовьте инструменты выбранной платы ESP32 в настройках.':!idf?.port?'Подключите плату и выберите ее USB-порт в верхней панели.':idf?.readingMac?'Определяем адрес платы на '+idf.port+'.':!mac&&idf?.busy?'MAC определится после завершения текущей операции.':'MAC определяется автоматически через USB. При чтении плата может перезапуститься.'}</p>}{idf?.deviceMac&&<p className="panel-note">Порт: {idf.deviceMac.port}</p>}

 <label className="field">Wi-Fi канал<input type="number" min={1} max={11} value={p.channel} disabled={busy} onChange={e=>set({channel:Number(e.target.value)})}/></label>
 <label className="field">Начальный режим<select aria-label="Начальный режим" value={p.mode} disabled={busy} onChange={e=>set({mode:e.target.value})}><option value="normal">Обычный (Normal)</option><option value="lr">Дальний (Long Range)</option></select></label>
 <label className="espnow-check"><input type="checkbox" checked={p.allowModeChange} disabled={busy} onChange={e=>set({allowModeChange:e.target.checked})}/>Переключать режим из логики</label>
 <label className="espnow-check"><input type="checkbox" checked={p.rememberMode===true} disabled={busy} onChange={e=>set({rememberMode:e.target.checked})}/>Запоминать режим передачи после перезагрузки</label>
 <p className="panel-note">{p.rememberMode===true?'Эта плата восстановит последний сохраненный режим. Если его еще нет, применит начальный режим. Сохранение работает для любых переключений из логики и не меняет режим других плат.':'После включения питания эта плата применит начальный режим из проекта.'}</p>
 {peers.some(peer=>peer.encrypted)&&<label className="espnow-check"><input type="checkbox" checked={showKeys} onChange={e=>setShowKeys(e.target.checked)}/>Показать ключи</label>}
 <div className="panel-label connections-heading">УДАЛЕННЫЕ УСТРОЙСТВА</div><p className="panel-note">На обеих платах выберите один канал. Включите «Шифровать соединение» и укажите одинаковый LMK на обеих платах пары. Команды принимаются только через зашифрованное соединение.</p>
 {peers.map((peer,index)=><article className="espnow-peer" key={peer.id}><header><strong>Устройство {index+1}</strong><button className="icon-button" aria-label={`Удалить устройство ${index+1}`} disabled={busy} onClick={()=>set({peers:JSON.stringify(peers.filter(item=>item.id!==peer.id))})}><Trash2 size={14}/></button></header><label className="field">Имя устройства<input value={peer.name} maxLength={40} disabled={busy} onChange={e=>update(peer.id,{name:e.target.value})}/></label><label className="field">MAC удаленного устройства<input value={peer.mac} maxLength={17} spellCheck={false} placeholder="AA:BB:CC:DD:EE:FF" disabled={busy} onChange={e=>update(peer.id,{mac:e.target.value.trim().toUpperCase()})}/></label><label className="espnow-check"><input type="checkbox" checked={peer.encrypted} disabled={busy} onChange={e=>update(peer.id,{encrypted:e.target.checked})}/>Шифровать соединение</label>{peer.encrypted&&<><label className="field">LMK · общий ключ пары<input type={showKeys?'text':'password'} autoComplete="off" value={peer.lmk} maxLength={32} disabled={busy} onChange={e=>update(peer.id,{lmk:e.target.value})}/></label><CopyLmk value={peer.lmk}/><button className="text-button" disabled={busy} onClick={()=>update(peer.id,{lmk:newKey()})}><KeyRound size={13}/>Создать новый LMK</button></>}</article>)}
 <button className="button secondary" disabled={busy||peers.length>=MAX_PEERS} onClick={()=>set({peers:JSON.stringify([...peers,{id:crypto.randomUUID(),name:'Устройство '+(peers.length+1),mac:'',encrypted:true,lmk:''}])})}><Plus size={14}/>Добавить устройство</button>
 <label className="field">Ожидание подтверждения, мс<input type="number" value={p.timeoutMs} min={100} max={30000} step={100} disabled={busy} onChange={e=>set({timeoutMs:Number(e.target.value)})}/></label><label className="field">Число повторов<input type="number" value={p.retries} min={0} max={5} disabled={busy} onChange={e=>set({retries:Number(e.target.value)})}/></label><p className="panel-note">Ключи сохраняются в файле проекта и входят в прошивку. Обычный режим и LR используют разные скорости передачи; прием обоих остается включенным.</p></div>;
}
