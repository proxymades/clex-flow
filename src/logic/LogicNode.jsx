import {logicVersionProblem} from './versions.js';
import {LEGACY_COLOR} from '../projects/legacy.js';
import {OUTPUT_MODULE,outputChannelCount} from '../gpio/model.js';
import ModuleIcon from '../components/ModuleIcon.jsx';
import {portSections} from './portGroups.js';
import {selectionSummary} from './selection.js';
import {numericSummary} from './numeric.js';
import {synchronizationSummary} from './synchronization.js';
import { formatCount } from '../utils/plural.js';
import {memo,useEffect} from 'react';
import {Handle,Position,useUpdateNodeInternals} from '@xyflow/react';
import {TriangleAlert,Link2,ArrowRightLeft,ListFilter,ListChecks,Clock3,Timer,Hash,Globe,Thermometer,Text,GitBranch,Radio,Info} from 'lucide-react';
import ScreenPreview from '../displays/ScreenPreview.jsx';
import PortValueStates from './PortValueStates.jsx';
import {TYPE_COLORS,TYPE_NAMES,LOGIC_NODE_WIDTH} from './model.js';
import {visiblePorts,nodeDisplayName} from './presentation.js';
const SUMMARY_ICONS={
 'clex.logic.timer':Clock3,
 'clex.logic.stopwatch':Timer,
 'clex.logic.counter':Hash,
 'clex.logic.compare-number':ListFilter,
 'clex.logic.text-to-number':ArrowRightLeft,
 'clex.logic.select-number':GitBranch,
 'clex.logic.synchronize':ListChecks,
 'clex.logic.temperature':Thermometer,
 'clex.logic.internet-check':Globe,
 'clex.logic.serial':Text,
};
function LogicNode({id,data,selected}){
 const {definition,node,binding,issueCount,onPort,pending,display,screen,project,catalog,connection,onBindData}=data;
 const versionProblem=logicVersionProblem(node,catalog);
 const ports=visiblePorts(node,project,catalog,{connection});
 const inputs=ports.inputs,outputs=ports.outputs,sections=portSections(ports);
 const layout=JSON.stringify([inputs,outputs].map(items=>items.map(port=>[port.id,port.name])));
 const updateNodeInternals=useUpdateNodeInternals();useEffect(()=>{updateNodeInternals(id);},[id,layout,updateNodeInternals]);
 const radioOption=definition?.parameters?.transferType?.options.find(option=>option.value===node.parameters.transferType)||definition?.parameters?.action?.options.find(option=>option.value===node.parameters.action);
 const radioSummary=radioOption?[radioOption.label,node.parameters.transferType==='command'?node.parameters.command:node.parameters.action==='mode'?definition.parameters.mode.options.find(option=>option.value===node.parameters.mode)?.label:binding?.component?.name].filter(Boolean).join(' · '):null;
 const outputSummary=definition?.id===OUTPUT_MODULE?[binding?.component?.name||'Выберите компонент',outputChannelCount(binding?.component)?'канал '+node.parameters.channel:null,radioOption?.label].filter(Boolean).join(' · '):null;
 const summary=versionProblem?'Требуется замена блока':outputSummary||selectionSummary(node)||synchronizationSummary(node)||numericSummary(node,project)||radioSummary|| (definition?.editor==='screen'?(binding?.component?.name||'Выберите дисплей'):definition?.id==='clex.logic.temperature'?(node.parameters.autoRead?`Кристалл · каждые ${node.parameters.intervalMs} мс`:'Кристалл · измерение по сигналу'):definition?.id==='clex.logic.timer'?`Каждые ${node.parameters.intervalMs} мс`:definition?.id==='clex.logic.stopwatch'?`00:00:00 · ${node.parameters.autoStart?'автозапуск':'запуск по сигналу'}`:definition?.id==='clex.logic.counter'?`Начало: ${node.parameters.initialValue} · изменение: ${node.parameters.step}`:definition?.id==='clex.logic.internet-check'?(node.parameters.url||'Укажите адрес проверки'):definition?.constraints.hardware?(binding?.component?.name||'Выберите компонент'):node.parameters.message||'Пустое сообщение');
 const title=nodeDisplayName(node,project,catalog);
 const hardwareSummary=Boolean(outputSummary||(!radioSummary&&definition?.constraints.hardware));
 const SummaryIcon=hardwareSummary?Link2:radioSummary?Radio:SUMMARY_ICONS[node.moduleId]||Info;
 function portView(port,direction){
  const active=pending?.nodeId===id&&pending.portId===port.id&&pending.direction===direction,tip=id+'-'+direction+'-'+encodeURIComponent(port.id);
  return <div key={direction+'-'+port.id} data-port-id={port.id} data-port-type={port.type} className={`logic-port ${direction} ${active?'pending-port':''} ${port.compatible?'compatible-port':''} ${port.incompatible?'incompatible-port':''}`} style={{'--port-color':port.legacy?LEGACY_COLOR:TYPE_COLORS[port.type]}}>
   <Handle isConnectable={!port.legacy} type={direction==='output'?'source':'target'} position={direction==='output'?Position.Right:Position.Left} id={port.id} aria-label={`${direction==='output'?'Выход':'Вход'} ${port.name}: ${title}`} aria-describedby={tip} title={port.description} tabIndex={port.legacy?-1:0} onKeyDown={event=>{if(!port.legacy&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();onPort({nodeId:id,portId:port.id,direction});}}}/>
   <button disabled={port.legacy} className="logic-port-name nodrag" aria-describedby={tip} aria-label={`${direction==='output'?'Выход':'Вход'}: ${title} / ${port.name}`} onClick={event=>{event.stopPropagation();onPort({nodeId:id,portId:port.id,direction});}}><span className="port-label-copy">{port.name}</span></button>
   <div className="port-tooltip" id={tip} role="tooltip"><strong>{port.name} · {port.legacy?'Старая связь':TYPE_NAMES[port.type]}</strong>{port.description}<PortValueStates port={port}/>{port.reason&&<em>{port.reason}</em>}</div>
  </div>;
 }
 return <article className={`logic-node ${selected?'node-selected':''} ${issueCount?'node-invalid':''} ${versionProblem?'node-version-incompatible':''}`} style={{width:LOGIC_NODE_WIDTH,'--node-color':definition?.color||'#fb7185'}}>
  <header className="logic-drag-handle">
   <span className="logic-node-icon"><ModuleIcon name={definition?.icon} size={22}/></span>
   <div className="logic-node-heading"><strong className="logic-node-type" title={definition?.name||node.moduleId}>{definition?.name||node.moduleId}</strong><small className="logic-node-name" title={title}>{title}</small></div>
   <span className="logic-node-version">v{node.moduleVersion}</span>
   {issueCount>0&&<span className="node-issue-count" title={formatCount(issueCount, ['ошибка', 'ошибки', 'ошибок'])}><TriangleAlert size={12}/>{issueCount}</span>}
  </header>
  <div className="logic-node-summary" title={hardwareSummary?'Связанный компонент: '+summary:summary}><SummaryIcon className="logic-node-summary-icon" size={14} aria-hidden="true"/><span>{summary}</span></div>
  {!versionProblem&&definition?.editor==='screen'&&display&&<><div className="logic-display-preview nodrag" title="Двойное нажатие открывает редактор экрана"><ScreenPreview display={display} screen={screen||{background:'#000000',elements:[]}}/></div>{screen?.elements.some(element=>element.mode==='dynamic'||element.captionDynamic)&&<button className="node-bind-button nodrag" disabled={data.busy} onClick={()=>onBindData(node)}><Link2 size={13}/>Подключить данные</button>}</>}
  {node.legacy&&<p className="panel-note">{node.legacy}</p>}
  {versionProblem&&<p className="logic-version-warning" role="note"><TriangleAlert size={14}/><span>{versionProblem}</span></p>}
  <div className="logic-ports">{sections.map(section=><section className={'logic-port-section '+section.id} data-port-section={section.id} key={section.id}>
   <div className="logic-port-section-titles"><span>{section.inputs.length>0&&section.inputTitle}</span><span>{section.outputs.length>0&&section.outputTitle}</span></div>
   {Array.from({length:Math.max(section.inputs.length,section.outputs.length)},(_,index)=><div className={'logic-port-row'+(!section.inputs[index]||!section.outputs[index]?' single-port-row':'')} key={index}>{section.inputs[index]&&portView(section.inputs[index],'input')}{section.outputs[index]&&portView(section.outputs[index],'output')}</div>)}
  </section>)}</div>
 </article>;
}
export default memo(LogicNode);
