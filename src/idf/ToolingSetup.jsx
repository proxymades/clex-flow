import Panel from '../components/Panel.jsx';
import Details from '../components/Details.jsx';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Cpu, FolderOpen, Download, RefreshCw, Square } from 'lucide-react';
import Modal from '../components/Modal.jsx';
const bytes=n=>`${(n/1024/1024).toFixed(0)} МиБ`;
export default function ToolingSetup({idf}) {
 const {desktop,setError}=idf;
 const [root,setRoot]=useState(''),[plan,setPlan]=useState(null),[checking,setChecking]=useState(false),[confirm,setConfirm]=useState(false),[approved,setApproved]=useState(false),[allow,setAllow]=useState(false);
 const installing=idf.job?.operation==='sdk_prepare_all',busy=idf.busy||checking;
 useEffect(()=>{let alive=true;if(desktop)invoke('tooling_directory',{root:null}).then(root=>{if(alive)setRoot(root);}).catch(error=>setError(String(error)));return()=>{alive=false;};},[desktop,setError]);
 async function inspect(){setChecking(true);setPlan(null);try{const p=await idf.planTools();setPlan(p);setRoot(p.root);setApproved(false);setAllow(false);setConfirm(true);}catch(e){idf.setError(String(e));}finally{setChecking(false);}}
 async function folder(){try{const selected=await invoke('tooling_directory',{root:null,choose:true});if(selected){setRoot(selected);setPlan(null);}}catch(e){idf.setError(String(e));}}
 const events=installing?idf.events:[],stage=events.filter(e=>e.stream==='system'&&e.status==='running').at(-1)?.text;
 return <Panel id="tooling-setup" className="settings-card sdk-manager">
  <div className="settings-icon"><Cpu size={23}/></div>
  <div>
   <h2>Подготовка инструментов</h2>
   <p>Для сборки и записи прошивки нужны дополнительные программы. CLEX Flow проверит их и предложит установить недостающие.</p>
   <div className="sdk-actions"><button className="button primary" disabled={!idf.desktop||busy||!idf.ready} onClick={inspect}><RefreshCw size={15}/>{checking?'Проверяем инструменты…':'Проверить и подготовить'}</button></div>
   <p className="fine-print">Перед загрузкой вы увидите список программ и размер файлов.</p>
   <Details title="Папка инструментов">
    <code className="storage-path">{root||'Папка данных CLEX Flow'}</code>
    <div className="sdk-actions"><button className="button secondary" disabled={!idf.desktop||busy} onClick={folder}><FolderOpen size={15}/>Выбрать папку инструментов</button></div>
    <p>Новые программы будут установлены в эту папку. Уже установленные останутся на месте.</p>
   </Details>
   {installing&&<div className="sdk-operation" role="log" aria-label="Подготовка инструментов">
    <header><strong>{idf.busy?(stage||'Подготовка…'):{success:'Инструменты подготовлены',failed:'Не удалось подготовить инструменты',cancelled:'Подготовка остановлена'}[idf.job.status]}</strong>{idf.busy&&<button className="text-button" onClick={idf.cancel}><Square size={13}/>Остановить</button>}</header>
    {idf.busy&&<progress/>}
    <pre>{events.filter(e=>e.status!=='progress').map(e=>e.text+(e.stream==='system'?'\n':'')).join('')}</pre>
   </div>}
   {confirm&&plan&&<Modal className="tooling-modal" title="Подготовить инструменты?" onClose={()=>setConfirm(false)}>
    <div className="tooling-bundles">{plan.bundles.map(b=><article className="tooling-bundle" key={b.target}><strong>{b.name}</strong><span className={`badge ${b.ready?'green':''}`}>{b.ready?'Готово':'Нужна установка'}</span><small>{b.ready?b.diagnostic:`Загрузка: ${bytes(b.estimatedMin)}–${bytes(b.estimatedMax)}`}</small></article>)}</div>
    <p>Примерный размер загрузки: {bytes(plan.estimatedMin)}–{bytes(plan.estimatedMax)}.</p>
    <p className="fine-print">Папка для новых установок:</p><code className="storage-path">{root}</code>
    {plan.bundles.some(b=>!b.ready&&b.target.startsWith('esp32'))&&<>
     <p className="fine-print">Нужно не менее 8 ГиБ свободного места для каждой новой установки ESP-IDF и 1 ГиБ для Arduino Nano.</p>
     <label className="flash-confirm"><input type="checkbox" checked={allow} onChange={e=>setAllow(e.target.checked)}/>Разрешить установку недостающих системных программ.</label>
    </>}
    {plan.estimatedMax>0&&<label className="flash-confirm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>Разрешаю загрузить и установить указанные инструменты.</label>}
    <footer><button className="button secondary" onClick={()=>setConfirm(false)}>Закрыть</button><button className="button primary" disabled={plan.estimatedMax>0&&!approved} onClick={async()=>{setConfirm(false);await idf.prepareAll(plan.bundles.filter(b=>!b.ready).map(b=>b.target),allow);}}><Download size={15}/>{plan.estimatedMax?'Подготовить все':'Завершить проверку'}</button></footer>
   </Modal>}
  </div>
 </Panel>;
}
