import {LEGACY_COLOR} from '../projects/legacy.js';
import {OUTPUT_MODULE,outputChannelCount} from '../gpio/model.js';
import MicAudioLines from '../components/MicAudioLines.jsx';
import {numericSummary} from './numeric.js';
import { formatCount } from '../utils/plural.js';
import {memo,useEffect} from 'react';
import {Handle,Position,useUpdateNodeInternals} from '@xyflow/react';
import { Mic, Gauge, Wifi, ToggleRight, RotateCw,Timer,ScanLine,ArrowUpRight,Repeat2,Terminal,Box,TriangleAlert,Monitor,Hash,Network,Globe,Link2, Camera, Volume2, Radio, GitBranch, Thermometer } from 'lucide-react';
import ScreenPreview from '../displays/ScreenPreview.jsx';
import PortValueStates from './PortValueStates.jsx';
import {TYPE_COLORS,TYPE_NAMES} from './model.js';
import {visiblePorts,nodeDisplayName} from './presentation.js';
const icons={ MicAudioLines, Mic, Gauge, Wifi, ToggleRight, RotateCw,Timer,ScanLine,ArrowUpRight,Repeat2,Terminal,Monitor,Hash,Network,Globe,Camera,Volume2,Radio,GitBranch,Thermometer};
function LogicNode({id,data,selected}){
 const {definition,node,binding,issueCount,onPort,pending,display,screen,project,catalog,connection,onBindData}=data;
 const ports=visiblePorts(node,project,catalog,{connection});
 const inputs=ports.inputs.filter(port=>!port.hidden),outputs=ports.outputs.filter(port=>!port.hidden),rows=Math.max(inputs.length,outputs.length);
 const extraCount=ports.inputs.concat(ports.outputs).filter(port=>port.hidden).length;
 const layout=JSON.stringify([inputs,outputs].map(items=>items.map(port=>[port.id,port.name])));
 const updateNodeInternals=useUpdateNodeInternals();useEffect(()=>{updateNodeInternals(id);},[id,layout,updateNodeInternals]);
 const Icon=icons[definition?.icon]||Box;
 const radioOption=definition?.parameters?.transferType?.options.find(option=>option.value===node.parameters.transferType)||definition?.parameters?.action?.options.find(option=>option.value===node.parameters.action);
 const radioSummary=radioOption?[radioOption.label,node.parameters.transferType==='command'?node.parameters.command:node.parameters.action==='mode'?definition.parameters.mode.options.find(option=>option.value===node.parameters.mode)?.label:binding?.component?.name].filter(Boolean).join(' · '):null;
 const outputSummary=definition?.id===OUTPUT_MODULE?[binding?.component?.name||'Выберите компонент',outputChannelCount(binding?.component)?'канал '+node.parameters.channel:null,radioOption?.label].filter(Boolean).join(' · '):null;
 const summary=outputSummary||numericSummary(node,project)||radioSummary|| (definition?.editor==='screen'?(binding?.component?.name||'Выберите дисплей'):definition?.id==='clex.logic.temperature'?(node.parameters.autoRead?`Кристалл · каждые ${node.parameters.intervalMs} мс`:'Кристалл · измерение по сигналу'):definition?.id==='clex.logic.timer'?`Каждые ${node.parameters.intervalMs} мс`:definition?.id==='clex.logic.stopwatch'?`00:00:00 · ${node.parameters.autoStart?'автозапуск':'запуск по сигналу'}`:definition?.id==='clex.logic.counter'?`Начало: ${node.parameters.initialValue} · изменение: ${node.parameters.step}`:definition?.id==='clex.logic.internet-check'?(node.parameters.url||'Укажите адрес проверки'):definition?.constraints.hardware?(binding?.component?.name||'Выберите компонент'):node.parameters.message||'Пустое сообщение');
 const title=nodeDisplayName(node,project,catalog);
 function portView(port,direction){
  const active=pending?.nodeId===id&&pending.portId===port.id&&pending.direction===direction,tip=id+'-'+direction+'-'+encodeURIComponent(port.id);
  return <div key={direction+'-'+port.id} data-port-id={port.id} data-port-type={port.type} className={`logic-port ${direction} ${active?'pending-port':''} ${port.compatible?'compatible-port':''} ${port.incompatible?'incompatible-port':''}`} style={{'--port-color':port.legacy?LEGACY_COLOR:TYPE_COLORS[port.type]}}>
   <Handle isConnectable={!port.legacy} type={direction==='output'?'source':'target'} position={direction==='output'?Position.Right:Position.Left} id={port.id} aria-label={`${direction==='output'?'Выход':'Вход'} ${port.name}: ${title}`} aria-describedby={tip} title={port.description} tabIndex={port.legacy?-1:0} onKeyDown={event=>{if(!port.legacy&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();onPort({nodeId:id,portId:port.id,direction});}}}/>
   <button disabled={port.legacy} className="logic-port-name nodrag" aria-describedby={tip} aria-label={`${direction==='output'?'Выход':'Вход'}: ${title} / ${port.name}`} onClick={event=>{event.stopPropagation();onPort({nodeId:id,portId:port.id,direction});}}><span className="port-type-dot"/><span className="port-label-copy">{port.name}</span></button>
   <div className="port-tooltip" id={tip} role="tooltip"><strong>{port.name} · {port.legacy?'Старая связь':TYPE_NAMES[port.type]}</strong>{port.description}<PortValueStates port={port}/>{port.reason&&<em>{port.reason}</em>}</div>
  </div>;
 }
 return <article className={`logic-node ${selected?'node-selected':''} ${issueCount?'node-invalid':''}`} style={{'--node-color':definition?.color||'#fb7185'}}>
  <header className="logic-drag-handle"><span className="logic-node-icon"><Icon size={19}/></span><div><strong title={title}>{title}</strong><small>{definition?.categoryName||'Модуль не установлен'} · v{node.moduleVersion}</small></div>{issueCount>0&&<span className="node-issue-count" title={formatCount(issueCount, ['ошибка', 'ошибки', 'ошибок'])}><TriangleAlert size={12}/>{issueCount}</span>}</header>
  <div className="logic-node-summary" title={summary}>{summary}</div>
  {definition?.editor==='screen'&&display&&<><div className="logic-display-preview nodrag" title="Двойное нажатие открывает редактор экрана"><ScreenPreview display={display} screen={screen||{background:'#000000',elements:[]}}/></div>{screen?.elements.some(element=>element.mode==='dynamic'||element.captionDynamic)&&<button className="node-bind-button nodrag" disabled={data.busy} onClick={()=>onBindData(node)}><Link2 size={13}/>Подключить данные</button>}</>}
  {extraCount>0&&<p className="panel-note">Ещё контакты: {extraCount}. Откройте свойства блока.</p>}
  {node.legacy&&<p className="panel-note">{node.legacy}</p>}
  {!definition&&<p className="logic-missing">Точная версия модуля отсутствует в библиотеке.</p>}
  <div className="logic-ports">{Array.from({length:rows},(_,index)=><div className={'logic-port-row'+(!inputs[index]||!outputs[index]?' single-port-row':'')} key={index}>{inputs[index]&&portView(inputs[index],'input')}{outputs[index]&&portView(outputs[index],'output')}</div>)}</div>
 </article>;
}
export default memo(LogicNode);
