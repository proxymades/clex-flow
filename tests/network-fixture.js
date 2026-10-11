import {displayProject} from './display-fixture.js';
import {catalog} from './catalog-fixture.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {newIndicator} from '../src/displays/indicator.js';
import {elementUpdatePort} from '../src/displays/model.js';
export const ethernetModule=catalog.modules.find(module=>module.network);
export const ethernetLogic=catalog.modules.find(module=>module.id==='clex.logic.ethernet');
export const probeModule=catalog.modules.find(module=>module.id==='clex.logic.internet-check');
export function networkProject(){
 let project=displayProject();project=addHardware(project,ethernetModule,catalog);
 const display=project.components.find(component=>component.moduleId!=='clex.hardware.ethernet'),network=project.components.find(component=>component.moduleId===ethernetModule.id),screen=project.screens[display.id],description=catalog.modules.find(module=>module.display).display;
 screen.background='#071521';screen.elements[0]={...screen.elements[0],text:'ESP32-S3 ETH',x:12,y:12,fontId:'montserrat_20',color:'#ffffff'};
 const make=(name,y,texts,colors)=>{const indicator=newIndicator(description);return {...indicator,name,x:10,y,width:220,height:46,mode:'dynamic',initialValue:0,states:texts.map((text,index)=>({id:crypto.randomUUID(),name:text,value:index,text,background:'#172536',color:'#ffffff',dotColor:colors[index]}))};};
 const eth=make('Ethernet',55,['Ethernet: Нет Link','Ethernet: Ожидание IP','Ethernet: Подключено','Ethernet: Ошибка'],['#ef6666','#fbbf24','#34d399','#ef6666']);eth.staticStateId=eth.states[0].id;eth.fallbackStateId=eth.states[3].id;
 const ip={id:crypto.randomUUID(),name:'IP-адрес',type:'text',text:'',mode:'dynamic',valueType:'text',initialValue:'',prefix:'IP: ',suffix:'',x:12,y:116,fontId:'montserrat_14',color:'#dfe9f5'};
 const internet=make('Интернет',157,['Интернет: Ожидание','Интернет: Проверка','Интернет: Доступен','Интернет: Недоступен'],['#97a6bd','#fbbf24','#34d399','#ef6666']);internet.staticStateId=internet.states[0].id;internet.fallbackStateId=internet.states[3].id;
 screen.elements.push(eth,ip,internet);
 let graph=addNode(project.logic,ethernetLogic,project.components,project,catalog);const ethNode=graph.nodes.at(-1);ethNode.parameters.componentId=network.id;
 graph=addNode(graph,probeModule,project.components,project,catalog);const probe=graph.nodes.at(-1);probe.parameters.url='https://example.com/';
 const view=graph.nodes[0];
 for(const [source,handle,target] of [[ethNode,'state',eth],[ethNode,'ip',ip],[probe,'state',internet]]){
  graph=connectNodes(graph,catalog,{source:source.id,sourceHandle:handle,target:view.id,targetHandle:target.id},{...project,logic:graph});
  graph=connectNodes(graph,catalog,{source:source.id,sourceHandle:'changed',target:view.id,targetHandle:elementUpdatePort(target.id)},{...project,logic:graph});
 }
 return withLogic(project,graph);
}
