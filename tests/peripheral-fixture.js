import { p4Project } from './p4-fixture.js';
import { catalog, timer } from './catalog-fixture.js';
import { addHardware, connectTerminal } from '../src/assembly/model.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
import { connectDisplayData } from '../src/logic/displayBindings.js';
export function peripheralProject({network=true,audio=true,camera=true,display=true}={}) {
 let p=p4Project(network);
 if(display){
  const physical=p.components.find(c=>catalog.modules.find(m=>m.id===c.moduleId)?.display),module=catalog.modules.find(m=>m.display?.interface==='dsi');
  physical.moduleId=module.id;physical.parameters={interfaceId:'mipi-display',brightness:70};
  p.assembly.connections=[];p.gpioAssignments=[];
  p=connectTerminal(p,catalog,physical.id,'vcc','P2-1');p=connectTerminal(p,catalog,physical.id,'gnd','P2-3');
 }
 if(audio)p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.audio'),catalog);
 if(camera)p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.camera'),catalog);
 let graph=p.logic;
 if(!graph.nodes.some(n=>n.moduleId===timer.id))graph=addNode(graph,timer,p.components,p,catalog);
 const clock=graph.nodes.find(n=>n.moduleId===timer.id),view=graph.nodes.find(n=>n.moduleId==='clex.logic.display');
 clock.parameters.intervalMs=1000;
 for(const [enabled,id] of [[audio,'clex.logic.tone'],[camera,'clex.logic.camera-capture']]){
  if(!enabled)continue;
  const module=catalog.modules.find(m=>m.id===id);graph=addNode(graph,module,p.components,p,catalog);const node=graph.nodes.at(-1);
  graph=connectNodes(graph,catalog,{source:clock.id,sourceHandle:'tick',target:node.id,targetHandle:'trigger'},{...p,logic:graph});
  if(camera && id==='clex.logic.camera-capture'){
   const element={id:crypto.randomUUID(),name:'Кадры',type:'text',text:'',mode:'dynamic',valueType:'number',initialValue:0,prefix:'Кадров: ',suffix:'',x:20,y:230,fontId:'montserrat_28',color:'#ffffff'};
   p.screens[view.parameters.componentId].elements.push(element);
   p=withLogic(p,graph);p=withLogic(p,connectDisplayData(p,catalog,{source:node.id,sourceHandle:'frames',target:view.id,targetHandle:element.id}));graph=p.logic;
  }
 }
 return withLogic(p,graph);
}
