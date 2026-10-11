import {addNode,connectNodes,graphModule,nodePorts,hardwareBinding,connectionProblem,validateGraph} from './model.js';
import {screenBindings,screenFor,elementUpdatePort} from '../displays/model.js';
import {presentPort,visiblePorts} from './presentation.js';
export function displaySources(project,catalog,displayNodeId,bindingId){
 const display=project.logic.nodes.find(node=>node.id===displayNodeId);if(!display)return [];
 const binding=screenBindings(screenFor(project,display.parameters.componentId)).find(item=>item.id===bindingId);if(!binding)return [];
 const old=project.logic.edges.find(edge=>edge.target===displayNodeId&&edge.targetHandle===bindingId);
 return project.logic.nodes.filter(node=>node.id!==displayNodeId).flatMap(node=>{
  const ports=nodePorts(node,catalog,project);
  return ports.outputs.filter(port=>port.type===binding.type).flatMap(port=>{
   if(connectionProblem(project.logic,catalog,{source:node.id,sourceHandle:port.id,target:displayNodeId,targetHandle:bindingId},old?.id,project))return [];
   const events=port.displayUpdateEvents||ports.outputs.filter(event=>event.type==='event'&&(port.readyOn?event.id===port.readyOn:true)).map(event=>({id:event.id,label:presentPort(event,node,project,catalog).name}));
   if(!events.length)return [];
   return [{node,port:presentPort(port,node,project,catalog),events,label:port.bindingLabel||'Показывать: '+presentPort(port,node,project,catalog).name}];
  });
 });
}
export function planDisplayBinding(project,catalog,choice){
 const {displayNodeId,bindingId,sourceNodeId,sourcePortId,eventId}=choice;
 const source=displaySources(project,catalog,displayNodeId,bindingId).find(item=>item.node.id===sourceNodeId&&item.port.id===sourcePortId);
 if(!source)throw new Error('Выберите совместимый источник данных.');
 const event=source.events.find(item=>item.id===eventId);if(!event)throw new Error('Выберите момент обновления элемента.');
 let graph={...project.logic,edges:[...project.logic.edges],nodes:[...project.logic.nodes]};const replaced=[],added=[];
 function connect(connection,replace=false){
  const previous=graph.edges.find(edge=>edge.target===connection.target&&edge.targetHandle===connection.targetHandle);
  if(previous&&previous.source===connection.source&&previous.sourceHandle===connection.sourceHandle)return;
  if(previous){if(!replace)throw new Error('Общий вход показа уже подключен. Для этого режима освободите его или выберите «Показывать ход проверки».');graph={...graph,edges:graph.edges.filter(edge=>edge.id!==previous.id)};replaced.push(previous);}
  graph=connectNodes(graph,catalog,connection,{...project,logic:graph});added.push(graph.edges.at(-1));
 }
 const common=graph.edges.find(edge=>edge.target===displayNodeId&&edge.targetHandle==='trigger');
 if(event.resetNetwork&&common?.source===sourceNodeId&&common.sourceHandle!==eventId)throw new Error('Общий вход показа получает ход проверки. Для обновления только результата измените эту общую связь или выберите «Показывать ход проверки».');
 connect({source:sourceNodeId,sourceHandle:sourcePortId,target:displayNodeId,targetHandle:bindingId},true);
 if(!(common?.source===sourceNodeId&&common.sourceHandle===eventId))connect({source:sourceNodeId,sourceHandle:eventId,target:displayNodeId,targetHandle:elementUpdatePort(bindingId)},true);
 const addedNodes=[];
 if(event.resetNetwork){
  let reset=graph.nodes.find(node=>graphModule(node,catalog)?.displayResetEvent&&!hardwareBinding(node,{...project,logic:graph},catalog).error);
  if(!reset){
   const module=catalog.modules.find(module=>module.displayResetEvent&&project.components.some(component=>module.constraints.hardware.modules?.includes(component.moduleId)));
   if(!module)throw new Error('Для сброса при потере сети добавьте блок состояния подключенного сетевого интерфейса.');
   if(common)throw new Error('Общий вход показа занят. Освободите его для сброса при потере сети или выберите «Показывать ход проверки».');
   graph=addNode(graph,module,project.components,{...project,logic:graph},catalog);reset=graph.nodes.at(-1);addedNodes.push(reset);
  }
  connect({source:reset.id,sourceHandle:graphModule(reset,catalog).displayResetEvent,target:displayNodeId,targetHandle:'trigger'});
 }
 const previous=new Set(validateGraph(project,catalog).filter(issue=>issue.severity==='error').map(issue=>JSON.stringify(issue)));
 const fresh=validateGraph({...project,logic:graph},catalog).filter(issue=>issue.severity==='error'&&!previous.has(JSON.stringify(issue)));
 if(fresh.length)throw new Error(fresh[0].message);
 // Make room only for contacts newly exposed by this binding. Existing manual
 // overlaps are left alone; positions are part of the same Undo transaction.
 const height=(node,context)=>{const ports=visiblePorts(node,context,catalog);return (graphModule(node,catalog)?.editor==='screen'?360:160)+Math.max(...['inputs','outputs'].map(key=>ports[key].filter(port=>!port.hidden).length))*44;};
 const after={...project,logic:graph};
 const queue=graph.nodes.flatMap(node=>{const old=project.logic.nodes.find(item=>item.id===node.id);return old&&height(node,after)>height(old,project)?[{id:node.id,y:old.position.y,height:height(old,project)}]:[];});
 let passes=0;
 while(queue.length&&passes++<graph.nodes.length*2){
  const changed=queue.shift(),root=graph.nodes.find(node=>node.id===changed.id),bottom=root.position.y+height(root,{...project,logic:graph})+32;
  graph={...graph,nodes:graph.nodes.map(node=>{
   if(node.id===root.id||node.position.x>=root.position.x+262||root.position.x>=node.position.x+262||node.position.y<changed.y+changed.height||node.position.y>=bottom||bottom>5000)return node;
   queue.push({id:node.id,y:node.position.y,height:height(node,{...project,logic:graph})});return {...node,position:{...node.position,y:bottom}};
  })};
 }
 return {graph,added,replaced,addedNodes};
}
