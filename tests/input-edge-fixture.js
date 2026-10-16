import{catalog}from'./catalog-fixture.js';import{createProject}from'../src/projects/model.js';import{addHardware,connectTerminal,connectionProblem}from'../src/assembly/model.js';import{addNode,connectNodes,withLogic}from'../src/logic/model.js';
export function inputEdgeProject(boardId='arduino-nano-atmega328p-ch340'){
 const board=catalog.boards.find(b=>b.id===boardId);let p=createProject('Событие входа','',boardId,{...Object.fromEntries(Object.entries(board.options||{}).map(([key,o])=>[key,o.default])),...(boardId==='waveshare-esp32-s3-eth'?{camera:'disconnected'}:{})});
 for(const id of ['clex.hardware.led','clex.hardware.button'])p=addHardware(p,catalog.modules.find(m=>m.id===id),catalog);
 const led=p.components[0],button=p.components[1];
 for(const[c,terminal]of[[led,'anode'],[led,'cathode'],[button,'signal'],[button,'ground']]){const pin=board.pins.find(pin=>!connectionProblem(p,catalog,c.id,terminal,pin.id));if(!pin)throw new Error('Нет свободного контакта для '+terminal);p=connectTerminal(p,catalog,c.id,terminal,pin.id);}
 let graph=p.logic;for(const id of ['clex.logic.gpio-edge','clex.logic.gpio-toggle','clex.logic.serial'])graph=addNode(graph,catalog.modules.find(m=>m.id===id),p.components,p,catalog);
 const[edge,toggle,serial]=graph.nodes;edge.parameters.componentId=button.id;toggle.parameters.componentId=led.id;
 for(const[source,sh,target,th]of[[edge,'falling',toggle,'trigger'],[toggle,'done',serial,'trigger']])graph=connectNodes(graph,catalog,{source:source.id,sourceHandle:sh,target:target.id,targetHandle:th},{...p,logic:graph});
 return withLogic(p,graph);
}
