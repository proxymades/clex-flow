import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
export const nano=catalog.boards.find(b=>b.target==='atmega328p');
export function nanoProject({blink=false,watch=false,bootloader='standard'}={}){
 let p=createProject('Nano: '+(blink?'светодиод':'счетчик'),'',nano.id,{bootloader});
 if(blink){p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.led'),catalog);const id=p.components[0].id;p=connectTerminal(p,catalog,id,'anode','D13');p=connectTerminal(p,catalog,id,'cathode','GND-R');}
 let graph=p.logic;
 const add=id=>{graph=addNode(graph,catalog.modules.find(m=>m.id===id),p.components,p,catalog);return graph.nodes.at(-1);};
 const timer=add('clex.logic.timer');timer.parameters.intervalMs=1000;
 const producer=add(blink?'clex.logic.gpio-toggle':watch?'clex.logic.stopwatch':'clex.logic.counter');
 if(blink)producer.parameters.componentId=p.components[0].id;
 const serial=add('clex.logic.serial');serial.parameters.message=blink?'Светодиод переключен':watch?'Время:':'Счетчик:';
 const connect=(source,sourceHandle,target,targetHandle)=>{graph=connectNodes(graph,catalog,{source:source.id,sourceHandle,target:target.id,targetHandle},{...p,logic:graph});};
 if(!watch)connect(timer,'tick',producer,blink?'trigger':'increment');
 if(watch){connect(producer,'changed',serial,'trigger');connect(producer,'text',serial,'text');}
 else {connect(producer,'done',serial,'trigger');if(!blink)connect(producer,'value',serial,'number');}
 return withLogic(p,graph);
}
