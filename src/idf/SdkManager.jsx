import Panel from '../components/Panel.jsx';
import Details from '../components/Details.jsx';
import { useState } from 'react';
import { Cpu, RefreshCw, Download, CheckCircle2, Trash2, Square, FolderSearch, AlertCircle } from 'lucide-react';
import ArduinoTools from './ArduinoTools.jsx';
import Modal from '../components/Modal.jsx';
import { SDK_STATES } from './sdkRequirements.js';
const bytes=value=>value<1024*1024*1024?`${(value/1024/1024).toFixed(1)} МиБ`:`${(value/1024/1024/1024).toFixed(1)} ГиБ`;
export default function SdkManager({idf}) {
 const [root,setRoot]=useState(idf.environment?.root || ''),[python,setPython]=useState(idf.environment?.python || '');
 const [toolsPath,setToolsPath]=useState(idf.environment?.toolsPath || '');
 const [version,setVersion]=useState('5.4.4'),[modal,setModal]=useState(null),[allowPrerequisites,setAllowPrerequisites]=useState(false),[confirmed,setConfirmed]=useState(false),[plan,setPlan]=useState(null),[planning,setPlanning]=useState(false);
 const snapshot=idf.sdks,active=snapshot?.active?.[idf.requirement?.target];
 const catalogError=idf.catalogError || snapshot?.catalogError;
 const installing=idf.job?.operation==='sdk_install';
 const sdkJob=idf.job?.operation.startsWith('sdk_')&&idf.job.operation!=='sdk_prepare_all';
 const events=sdkJob?idf.events:[];
 const progress=events.filter(event=>event.downloaded!==null&&event.downloaded!==undefined).at(-1);
 const percent=progress?.total?Math.min(100,Math.round(progress.downloaded/progress.total*100)):null;
 const stage=events.filter(event=>event.stream==='system'&&event.status==='running').at(-1)?.text;
 const unavailable=!idf.desktop||idf.busy||!idf.ready;
 const existingRequired=snapshot?.installations.find(sdk=>sdk.version===idf.requirement?.version && sdk.state==='ready' && (sdk.environment?.target || 'esp32s3')===idf.requirement?.target);
 async function verify(path,interpreter,tools){const result=await idf.check(path,interpreter,tools);if(result){setRoot(result.root);setPython(result.python);setToolsPath(result.toolsPath);}}
 async function prepare(version){setModal({type:'install',version});setAllowPrerequisites(false);setConfirmed(false);setPlan(null);setPlanning(true);try{setPlan(await idf.installPlan(version));}catch(error){idf.setError(String(error));}finally{setPlanning(false);}}
 const close=()=>{if(!planning)setModal(null);};
 if(idf.requirement?.family==='arduino-avr')return <ArduinoTools idf={idf}/>;
 return <>
 <Panel className="settings-card sdk-manager">
  <div className="settings-icon"><Cpu size={23}/></div>
  <div>
   <h2>Инструменты ESP32 <span className={`badge ${idf.compatible?'green':''}`}>{idf.checking?'Проверяем…':idf.compatible?'Готово к работе':idf.environment?'Нужна другая версия':'Нужна подготовка'}</span></h2>
   <p>ESP-IDF — набор программ для сборки и записи прошивки плат ESP32. Для CLEX Flow нужна версия {idf.requirement?.version}.</p>
   {!idf.desktop&&<p className="inspector-warning">Установить и проверить инструменты можно в приложении CLEX Flow.</p>}
   {!idf.compatible&&idf.environment&&<p className="inspector-warning">Выбрана ESP-IDF {idf.environment.sdkVersion}. Для сборки прошивки выберите версию {idf.requirement?.version}.</p>}
   <div className="sdk-actions">
    <button className="button secondary" disabled={unavailable} onClick={()=>idf.check()}><FolderSearch size={15}/>Проверить инструменты</button>
    {!idf.compatible&&<button className="button primary" disabled={unavailable} onClick={()=>existingRequired?idf.selectSdk(existingRequired.id):prepare(idf.requirement?.version || '5.4.4')}>{existingRequired?<CheckCircle2 size={15}/>:<Download size={15}/>} {existingRequired?'Использовать установленную версию':'Установить ESP-IDF '+(idf.requirement?.version || '5.4.4')}</button>}
   </div>
   {catalogError&&<div className="catalog-notice" role="status">
    <p>Не удалось обновить список версий ESP-IDF. Показан ранее сохранённый список.</p>
    <button className="text-button" disabled={unavailable} onClick={idf.refreshCatalog}><RefreshCw size={14}/>Повторить обновление</button>
    <Details title="Технические подробности"><pre>{catalogError}</pre></Details>
   </div>}
   <Details title="Установки и дополнительные настройки" className="sdk-options">
    <h3 className="sdk-subheading">Найденные установки ESP-IDF</h3>
    {!snapshot?.installations.length?<p className="sdk-empty">ESP-IDF не найдена. Установите нужную версию кнопкой выше или укажите папку с уже установленной ESP-IDF.</p>:<div className="sdk-list">{snapshot.installations.map(sdk=><article className={`sdk-row ${active===sdk.id?'active':''}`} key={sdk.id}>
     <header><strong>ESP-IDF {sdk.version}</strong><span className={`badge ${sdk.state==='ready'?'green':''}`}>{SDK_STATES[sdk.state] || sdk.state}</span>{active===sdk.id&&<span className="sdk-active-label">Используется для этой платы</span>}</header>
     <code>{sdk.root}</code>
     <small>{sdk.managed?'Установлена через CLEX Flow':'Установлена отдельно · CLEX Flow не удаляет эту папку'}</small>
     {sdk.diagnostic&&sdk.state!=='ready'&&<p className="sdk-diagnostic">{sdk.diagnostic}</p>}
     <div className="sdk-row-actions"><button className="text-button" disabled={unavailable||sdk.state==='missing'||sdk.state==='installing'} onClick={()=>idf.selectSdk(sdk.id)}><CheckCircle2 size={14}/>Проверить и выбрать</button>{sdk.managed&&sdk.state!=='ready'&&<button className="text-button" disabled={unavailable} onClick={()=>prepare(sdk.version)}><RefreshCw size={14}/>Повторить установку</button>}{sdk.managed&&<button className="text-button sdk-delete" disabled={unavailable} onClick={()=>{setConfirmed(false);setModal({type:'remove',sdk});}}><Trash2 size={14}/>Удалить</button>}</div>
    </article>)}</div>}
    <h3 className="sdk-subheading">Установить другую версию</h3>
    <div className="sdk-catalog">
     <select aria-label="Версия ESP-IDF для установки" value={version} disabled={unavailable} onChange={event=>setVersion(event.target.value)}>{(snapshot?.available || [{version:'5.4.4',supported:true}]).map(item=><option value={item.version} key={item.version}>{item.version}{item.supported?' · подходит для CLEX Flow':' · другая версия'}</option>)}</select>
     <button className="button secondary" disabled={unavailable || snapshot?.installations.some(sdk=>sdk.version===version && sdk.state==='ready' && (sdk.environment?.target || 'esp32s3')===idf.requirement?.target)} onClick={()=>prepare(version)}><Download size={14}/>Установить версию</button>
     <button className="button secondary" disabled={unavailable} onClick={idf.refreshCatalog}><RefreshCw size={15}/>Обновить список версий</button>
    </div>
    <p className="fine-print">Версии хранятся отдельно. Для работы в CLEX Flow используйте ESP-IDF {idf.requirement?.version}.</p>
    <Details title="Подключить установленную ESP-IDF" className="sdk-external">
     <p>Обычно достаточно указать папку ESP-IDF. Остальные пути определяются автоматически.</p>
     <label className="field">Папка ESP-IDF<input value={root} disabled={idf.busy} onChange={event=>setRoot(event.target.value)} placeholder="Папка Espressif или папка с файлом tools/idf.py"/></label>
     <label className="field">Python (необязательно)<input value={python} disabled={idf.busy} onChange={event=>setPython(event.target.value)} placeholder="Путь к Python из установки ESP-IDF"/></label>
     <label className="field">Папка инструментов (необязательно)<input value={toolsPath} disabled={idf.busy} onChange={event=>setToolsPath(event.target.value)} placeholder="Определяется автоматически"/></label>
     <div className="button-row"><button className="button primary" disabled={!idf.desktop||idf.busy} onClick={()=>verify(root||null,python||null,toolsPath||null)}><CheckCircle2 size={15}/>Проверить пути</button><button className="button secondary" disabled={!idf.desktop||idf.busy} onClick={()=>verify('','','')}><RefreshCw size={15}/>Найти автоматически</button></div>
    </Details>
    <label className="field console-mode">Вывод сообщений с платы<select value={idf.consoleMode} disabled={idf.busy} onChange={event=>idf.setConsole(event.target.value)}>{idf.consoleModes.includes('usb') && <option value="usb">Через USB (Serial/JTAG)</option>}<option value="uart">Через USB-UART (UART0)</option></select></label>
    <p className="fine-print">После изменения способа вывода соберите и запишите прошивку заново.</p>
    {idf.environment&&<Details title="Проверенные программы"><div className="tool-status"><span><CheckCircle2 size={14}/>{idf.environment.version}</span><code>{idf.environment.compilerVersion}</code><code>{idf.environment.cmakeVersion}</code><code>Ninja {idf.environment.ninjaVersion}</code><small>Python: {idf.environment.python}</small></div></Details>}
    <p className="fine-print">Папка для новых установок ESP-IDF: {snapshot?.managedPath || 'папка данных CLEX Flow'}. Уже установленные инструменты остаются на месте.</p>
   </Details>
   {sdkJob&&<div className="sdk-operation" role="log" aria-label="Журнал ESP-IDF">
    <header><strong>{idf.busy?(stage || 'Выполняем операцию…'):{success:'Готово',failed:'Не удалось завершить операцию',cancelled:'Остановлено'}[idf.job.status]}</strong>{idf.busy&&idf.job.operation!=='sdk_remove'&&<button className="text-button" onClick={idf.cancel}><Square size={13}/>Остановить</button>}</header>
    {installing&&idf.busy&&<><progress max={100} {...(percent!==null?{value:percent}:{})}/><small>{percent!==null?`Загружено: ${percent}% · ${bytes(progress.downloaded)} из ${bytes(progress.total)}`:'Загружаем и настраиваем инструменты…'}</small></>}
    <pre>{events.filter(event=>event.status!=='progress').map(event=>event.text+(event.stream==='system'?'\n':'')).join('')}</pre>
   </div>}
   {idf.error&&<p className="inspector-warning"><AlertCircle size={15}/>{idf.error}</p>}
  </div>
 </Panel>
 {modal?.type==='install'&&<Modal title={`Установить ESP-IDF ${modal.version}?`} onClose={close} busy={planning}>
  <p className="modal-intro">CLEX Flow загрузит ESP-IDF и необходимые программы в отдельную папку.</p>
  <div className="sdk-install-summary">
   {planning?<p>Уточняем размер загрузки…</p>:plan?<><strong>Примерный размер загрузки: {bytes(plan.estimatedMin)}–{bytes(plan.estimatedMax)}</strong><small>Размер файлов может отличаться. Для установки нужно не менее 8 ГиБ свободного места.</small></>:<p>Не удалось узнать размер загрузки. Проверьте подключение к интернету и повторите попытку.</p>}
  </div>
  <Details title="Что будет установлено"><p className="modal-intro">Официальная программа Espressif (EIM) установит ESP-IDF, Python и инструменты сборки. Загрузка инструментов: {plan?bytes(plan.toolBytes):'уточняется'}; исходники ESP-IDF и другие необходимые файлы загружаются отдельно.</p></Details>
  <label className="flash-confirm"><input type="checkbox" checked={allowPrerequisites} onChange={event=>setAllowPrerequisites(event.target.checked)}/>Разрешить установку недостающих системных программ. На macOS может потребоваться Homebrew.</label>
  <label className="flash-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>Разрешаю загрузить и установить ESP-IDF.</label>
  <footer><button className="button secondary" disabled={planning} onClick={close}>Отмена</button><button className="button primary" disabled={planning||!plan||!confirmed||idf.busy} onClick={()=>{setModal(null);idf.installSdk(modal.version,allowPrerequisites);}}><Download size={15}/>Установить</button></footer>
 </Modal>}
 {modal?.type==='remove'&&<Modal title={`Удалить ESP-IDF ${modal.sdk.version}?`} onClose={close}>
  <p className="modal-intro">Эта копия ESP-IDF и её инструменты будут удалены с диска. Отменить удаление нельзя.</p>
  <code className="sdk-remove-path">{modal.sdk.slot}</code>
  <label className="flash-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>Разрешаю удалить эту установку.</label>
  <footer><button className="button secondary" onClick={close}>Отмена</button><button className="button danger" disabled={!confirmed||idf.busy} onClick={()=>{setModal(null);idf.removeSdk(modal.sdk.id);}}>Удалить SDK</button></footer>
 </Modal>}
 </>;
}
