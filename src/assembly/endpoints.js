import {resolveRelayModule} from '../relay/model.js';
export const componentContact=(id,terminal)=>`component:${id}:${terminal}`;
export function parseContact(value){const match=/^component:([^:]+):([^:]+)$/.exec(value||'');return match?{componentId:match[1],terminalId:match[2]}:null;}
export const wireSource=wire=>wire.sourceComponentId?componentContact(wire.sourceComponentId,wire.sourceTerminalId):wire.boardPinId;
export const touches=(wire,id,terminal)=>wire.componentId===id&&(!terminal||wire.terminalId===terminal)||wire.sourceComponentId===id&&(!terminal||wire.sourceTerminalId===terminal);
export function contactInfo(project,catalog,id,terminal){
 const component=project.components.find(c=>c.id===id),module=resolveRelayModule(component,catalog.modules.find(m=>m.id===component?.moduleId));
 return {component,module,terminal:module?.terminals.find(t=>t.id===terminal)};
}
export function normalizedContact(project,catalog,componentId,terminalId,value){
 const source=parseContact(value);if(!source)return {componentId,terminalId,value};
 const a=contactInfo(project,catalog,componentId,terminalId),b=contactInfo(project,catalog,source.componentId,source.terminalId);
 const output=t=>t?.kind==='winding-output';
 if(output(a.terminal)&&!output(b.terminal))return {componentId:source.componentId,terminalId:source.terminalId,value:componentContact(componentId,terminalId)};
 return {componentId,terminalId,value};
}
export function componentWireProblem(project,catalog,componentId,terminalId,value){
 const source=parseContact(value);if(!source)return 'Контакт компонента не найден.';
 const a=contactInfo(project,catalog,componentId,terminalId),b=contactInfo(project,catalog,source.componentId,source.terminalId);
 if(!a.component||!b.component||!a.terminal||!b.terminal)return 'Компонент или контакт соединения удален.';
 if(componentId===source.componentId)return 'Нельзя соединять компонент с самим собой.';
 const input=a.terminal,output=b.terminal;
 if(input.kind==='winding-input'&&output.kind==='winding-output'){
  if(input.phase!==output.phase)return 'Соединяйте обмотку A с выходами A, обмотку B с выходами B.';
  const occupied=project.assembly.connections.find(w=>w.sourceComponentId===source.componentId&&w.sourceTerminalId===source.terminalId&&!(w.componentId===componentId&&w.terminalId===terminalId));
  if(occupied)return 'Выход обмотки уже подключен. Один выход драйвера используется одним контактом двигателя.';
  const other=project.assembly.connections.find(w=>w.componentId===componentId&&w.terminalId!==terminalId&&w.sourceComponentId&&w.sourceComponentId!==source.componentId);
  if(other)return 'Все четыре провода двигателя должны идти к одному драйверу.';
  return null;
 }
 return 'Соединение несовместимо: питание, GPIO и обмотки имеют разные назначения.';
}
export function connectionLabel(project,catalog,wire,componentId=wire.componentId){
 if(wire.sourceComponentId){const other=wire.componentId===componentId?{id:wire.sourceComponentId,terminal:wire.sourceTerminalId}:{id:wire.componentId,terminal:wire.terminalId};const info=contactInfo(project,catalog,other.id,other.terminal);return `${info.component?.name||other.id}: ${info.terminal?.label||other.terminal}`;}
 return catalog.boards.find(b=>b.id===project.boardId)?.pins.find(p=>p.id===wire.boardPinId)?.label||wire.boardPinId;
}
