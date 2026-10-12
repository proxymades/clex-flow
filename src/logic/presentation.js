import {graphModule,nodePorts,connectionProblem} from './model.js';
import {screenBindings,screenFor} from '../displays/model.js';
export function equipmentPresentation(node,project,catalog){
 const component=project.components.find(item=>item.id===node.parameters.componentId);
 const hardware=catalog.modules.find(item=>item.id===component?.moduleId);
 const operation=graphModule(node,catalog)?.firmware?.generatorKey?.replace('gpio-','');
 return {component,metadata:hardware?.logicPresentation,operation};
}
export function presentPort(port,node,project,catalog){
 const module=graphModule(node,catalog),{metadata,operation}=equipmentPresentation(node,project,catalog);
 let name=metadata?.[operation]?.[port.id]||port.name,description=metadata?.[operation]?.descriptions?.[port.id]||port.description;
 if(module?.firmware?.generatorKey==='counter'&&port.id==='increment'){
  const step=node.parameters.step;name=step>0?'Прибавить '+step:step<0?'Вычесть '+Math.abs(step):'Применить шаг 0';
  description=step===0?'Сохраняет число и отправляет сигнал «Счетчик обновлен».':'При получении сигнала '+(step>0?'прибавляет '+step:'вычитает '+Math.abs(step))+'.';
 }
 if(module?.editor==='screen'){
  const bindings=screenBindings(screenFor(project,node.parameters.componentId));
  const binding=bindings.find(item=>item.id===port.id||'update.'+item.id===port.id);
  if(port.id==='trigger'){name='Обновить все значения';description='Обновляет все динамические элементы из связанных источников.';}
  else if(binding){
   const action=port.type==='event',caption=binding.channel==='caption',state=binding.channel==='state';
   name=(action?caption?'Обновить надпись: ':state?'Обновить состояние: ':'Обновить: ':caption?'Надпись: ':state?'Состояние: ':({number:'Число: ',boolean:'Да/Нет: ',text:'Текст: '}[binding.type]))+(binding.element.name||binding.name);
   description=action?'Обновляет этот элемент текущими данными источника.':caption?'Принимает надпись индикатора; оформление зависит от состояния.':state?'Выбирает настроенное оформление индикатора по полученному значению.':'Принимает данные для элемента. Сигнал обновления подключается автоматически; его также можно настроить вручную.';
  }
 }
 return {...port,name,description:description||'Передает данные или сигнал между блоками.'};
}
export function visiblePorts(node,project,catalog,{expanded=false,connection=null}={}){
 const raw=nodePorts(node,catalog,project),screen=graphModule(node,catalog)?.editor==='screen';
 return Object.fromEntries(['inputs','outputs'].map(direction=>[direction,raw[direction].map(port=>{
  const connected=project.logic.edges.some(edge=>direction==='inputs'?edge.target===node.id&&edge.targetHandle===port.id:edge.source===node.id&&edge.sourceHandle===port.id);
  const candidate=connection&&connection.nodeId!==node.id&&connection.direction!==(direction==='inputs'?'input':'output');
  const link=candidate?(direction==='inputs'?{source:connection.nodeId,sourceHandle:connection.portId,target:node.id,targetHandle:port.id}:{source:node.id,sourceHandle:port.id,target:connection.nodeId,targetHandle:connection.portId}):null;
  const reason=link?connectionProblem(project.logic,catalog,link,null,project):null,compatible=Boolean(link&&!reason);
  const additional=screen?port.id==='trigger':Boolean(port.additional);
  return {...presentPort(port,node,project,catalog),additional,connected,compatible,incompatible:Boolean(connection&&!compatible&&!(connection.nodeId===node.id&&connection.portId===port.id)),reason,hidden:additional&&!connected&&!expanded&&!compatible};
 })]));
}
export function friendlyConnectionProblem(project,catalog,connection){
 const problem=connectionProblem(project.logic,catalog,connection,null,project);if(!problem)return null;
 const source=project.logic.nodes.find(node=>node.id===connection.source),target=project.logic.nodes.find(node=>node.id===connection.target);
 if(!source||!target)return problem;
 const output=nodePorts(source,catalog,project).outputs.find(port=>port.id===connection.sourceHandle),input=nodePorts(target,catalog,project).inputs.find(port=>port.id===connection.targetHandle);
 if(output&&input&&output.type!==input.type){
  const types={event:'сигнал действия',number:'число',boolean:'Да/Нет',text:'текст'};
  return 'Вход «'+presentPort(input,target,project,catalog).name+'» принимает '+types[input.type]+', а выход «'+presentPort(output,source,project,catalog).name+'» передает '+types[output.type]+'.';
 }
 return problem;
}
export function friendlyIssue(issue,project,catalog){
 const edge=project.logic.edges.find(edge=>edge.id===issue.edgeId);
 if(issue.code==='logic-order'&&edge){
  const source=project.logic.nodes.find(node=>node.id===edge.source),target=project.logic.nodes.find(node=>node.id===edge.target);
  const output=source&&nodePorts(source,catalog,project).outputs.find(port=>port.id===edge.sourceHandle);
  const signal=source&&nodePorts(source,catalog,project).outputs.find(port=>port.id===output?.readyOn);
  const input=target&&(nodePorts(target,catalog,project).inputs.find(port=>port.id==='update.'+edge.targetHandle)||nodePorts(target,catalog,project).inputs.find(port=>port.id==='trigger'));
  if(signal&&input)return {...issue,message:'Чтобы показать данные после обновления, соедините «'+presentPort(signal,source,project,catalog).name+'» с «'+presentPort(input,target,project,catalog).name+'».'};
 }
 return issue;
}
export function nodeDisplayName(node,project,catalog){
 const definition=graphModule(node,catalog),hardware=equipmentPresentation(node,project,catalog);
 const prefix=[definition?.name,...(definition?.legacyNames||[])].find(name=>name&&node.name.startsWith(name+' ')&&/^\d+$/.test(node.name.slice(name.length+1)));
 return prefix?(hardware.metadata?.[hardware.operation]?.title||definition.name)+' '+node.name.slice(prefix.length+1):node.name;
}
