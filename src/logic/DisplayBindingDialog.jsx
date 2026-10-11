import {useState} from 'react';
import Modal from '../components/Modal.jsx';
import {nodeDisplayName} from './presentation.js';
import {screenBindings,screenFor} from '../displays/model.js';
import {displaySources,planDisplayBinding} from './displayBindings.js';
export default function DisplayBindingDialog({node,project,catalog,busy,onClose,onApply}){
 const bindings=screenBindings(screenFor(project,node.parameters.componentId));
 const [bindingId,setBindingId]=useState(bindings[0]?.id||''),[selected,setSelected]=useState(''),[eventId,setEventId]=useState('');
 const sources=displaySources(project,catalog,node.id,bindingId);
 const existing=project.logic.edges.find(edge=>edge.target===node.id&&edge.targetHandle===bindingId);
 const previous=existing&&JSON.stringify([existing.source,existing.sourceHandle]);
 const key=selected||(sources.some(item=>JSON.stringify([item.node.id,item.port.id])===previous)?previous:JSON.stringify(sources[0]?[sources[0].node.id,sources[0].port.id]:[]));
 const source=sources.find(item=>JSON.stringify([item.node.id,item.port.id])===key);
 const currentEvent=source&&project.logic.edges.find(edge=>edge.source===source.node.id&&edge.target===node.id&&['update.'+bindingId,'trigger'].includes(edge.targetHandle)&&source.events.some(event=>event.id===edge.sourceHandle));
 const event=eventId||currentEvent?.sourceHandle||source?.events[0]?.id||'';
 let plan=null,error='';try{if(source)plan=planDisplayBinding(project,catalog,{displayNodeId:node.id,bindingId,sourceNodeId:source.node.id,sourcePortId:source.port.id,eventId:event});}catch(problem){error=problem.message;}
 return <Modal title="Подключить данные к дисплею" className="display-binding-modal" onClose={onClose} busy={busy}>
  <p className="modal-intro">Выберите элемент экрана и источник. CLEX Flow соединит данные и сигнал показа.</p>
  <label className="field">Элемент экрана<select aria-label="Элемент экрана" value={bindingId} disabled={busy} onChange={event=>{setBindingId(event.target.value);setSelected('');setEventId('');}}>{bindings.map(binding=><option key={binding.id} value={binding.id}>{binding.name}</option>)}</select></label>
  <label className="field">Источник данных<select aria-label="Источник данных" value={key} disabled={busy||!sources.length} onChange={event=>{setSelected(event.target.value);setEventId('');}}>{!sources.length&&<option value="[]">Нет подходящих источников</option>}{sources.map(item=><option key={JSON.stringify([item.node.id,item.port.id])} value={JSON.stringify([item.node.id,item.port.id])}>{item.label} · {nodeDisplayName(item.node,project,catalog)}</option>)}</select></label>
  {!sources.length&&<p className="panel-note">Добавьте блок с подходящим выходом. Тип элемента выбирается в редакторе экрана.</p>}
  {source&&<label className="field">Когда показывать<select aria-label="Когда показывать" value={event} disabled={busy} onChange={event=>setEventId(event.target.value)}>{source.events.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
  {plan&&<div className="binding-review"><strong>После подключения</strong><p>{source?.port.description}</p><p>{plan.added.length?`Будет создано связей: ${plan.added.length}.`:'Нужные связи уже подключены.'}</p>{plan.replaced.length>0&&<p>Привязка выбранного элемента будет заменена. Остальные элементы сохраняют свои связи.</p>}{plan.addedNodes.map(item=><p key={item.id}>Будет добавлен «{item.name}» для сброса при потере сети.</p>)}{source?.events.find(item=>item.id===event)?.resetNetwork&&<p>Последний результат сохраняется во время запросов и сбрасывается при потере IP.</p>}</div>}
  {error&&<p className="binding-error" role="alert">{error}</p>}
  <footer><button className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy||!plan||(plan.added.length===0&&plan.replaced.length===0)} onClick={()=>onApply(plan.graph)}>Подключить</button></footer>
 </Modal>;
}
