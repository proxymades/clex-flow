import Panel from '../components/Panel.jsx';
import Details from '../components/Details.jsx';
import { useState } from 'react';
import { Cpu, CheckCircle2, RefreshCw } from 'lucide-react';
export default function ArduinoTools({idf}){
 const [cli,setCli]=useState(idf.environment?.arduino?.cli||''),[data,setData]=useState(idf.environment?.root||'');
 const env=idf.compatible?idf.environment:null;
 async function check(manual){const env=await idf.check(manual?cli:null,null,manual?data:null);if(env){setCli(env.arduino?.cli||'');setData(env.root);}}
 return <Panel className="settings-card sdk-manager">
  <div className="settings-icon"><Cpu size={23}/></div>
  <div>
   <h2>Инструменты Arduino Nano <span className={`badge ${env?'green':''}`}>{idf.checking?'Проверяем…':env?'Готово к работе':'Нужна подготовка'}</span></h2>
   <p>Программы для сборки и записи прошивки Arduino Nano.</p>
   <div className="sdk-actions"><button className="button secondary" disabled={!idf.desktop||idf.busy} onClick={()=>check(false)}><RefreshCw size={15}/>Найти и проверить Arduino</button><a className="button secondary" href="#tooling-setup">Подготовить инструменты</a></div>
   <Details title="Подключить установленные инструменты Arduino" className="sdk-external">
    <label className="field">Файл Arduino CLI<input value={cli} onChange={e=>setCli(e.target.value)} disabled={idf.busy} placeholder="Путь к arduino-cli или arduino-cli.exe"/></label>
    <label className="field">Папка данных Arduino<input value={data} onChange={e=>setData(e.target.value)} disabled={idf.busy} placeholder="Папка Arduino15 с подпапкой packages"/></label>
    <button className="button primary" disabled={!idf.desktop||idf.busy||!cli.trim()||!data.trim()} onClick={()=>check(true)}><CheckCircle2 size={15}/>Проверить пути</button>
   </Details>
   <Details title="Версии программ и подключение платы">
    <p>Используется Arduino AVR Boards 1.8.6 с инструментами AVR GCC и AVRDUDE.</p>
    {env&&<div className="tool-status"><span><CheckCircle2 size={14}/>{env.version}</span><code>{env.compilerVersion}</code><small>{env.root}</small></div>}
    <p>Тип загрузчика выбирается в настройках платы внутри проекта. Скорость записи: 115200 бод для обычного загрузчика и 57600 для старого. Скорость монитора: 115200 бод.</p>
    <p>Если плата с CH340G не появилась в списке портов, проверьте USB-кабель. На Windows может понадобиться <a href="https://www.wch.cn/downloads/CH341SER_EXE.html" target="_blank" rel="noreferrer">драйвер WCH</a>.</p>
   </Details>
   {idf.error&&<p className="inspector-warning">{idf.error}</p>}
  </div>
 </Panel>;
}
