import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic,updateNode} from '../src/logic/model.js';
export const testKey='0123456789abcdef0123456789abcdef';
export function espNowProject({combined=false,zeroPeers=false,receiver=true}={}){
 let p=createProject('ESP-NOW: '+(zeroPeers?'MAC':receiver?'приемник':'отправитель'),'','waveshare-esp32-s3-eth',{camera:'disconnected'});
 p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.espnow'),catalog);const component=p.components[0];
 component.parameters.pmk=testKey;component.parameters.peers=JSON.stringify(zeroPeers?[]:[{id:'12345678-1234-4234-8234-123456789abc',name:'Вторая плата',mac:'02:11:22:33:44:55',encrypted:true,lmk:testKey}]);
 let graph=p.logic;const nodes={};
 function add(name,key,parameters={}){graph=addNode(graph,catalog.modules.find(m=>m.id===key),p.components,p,catalog);let n=graph.nodes.at(-1);graph=updateNode(graph,n.id,{parameters:{...n.parameters,...parameters}});nodes[name]=graph.nodes.find(node=>node.id===n.id);}
 const radio=(name,key,parameters={})=>add(name,'clex.logic.espnow-'+key,parameters);
 function connect(s,sh,t,th){graph=connectNodes(graph,catalog,{source:nodes[s].id,sourceHandle:sh,target:nodes[t].id,targetHandle:th},{...p,logic:graph});}
 radio('status','control',{action:'status'});add('serial','clex.logic.serial');connect('status','changed','serial','trigger');connect('status','mac','serial','text');
 if(!zeroPeers){
  radio('message','receive',{transferType:'message'});
  if(receiver||combined){radio('command','receive',{transferType:'command'});radio('mode','control',{action:'mode'});radio('ack','ack');connect('command','commandReceived','mode','trigger');connect('mode','done','ack','trigger');connect('mode','failed','ack','reject');radio('normalCommand','receive',{transferType:'command',command:'SET_NORMAL'});radio('normalMode','control',{action:'mode',mode:'normal'});radio('normalAck','ack');connect('normalCommand','commandReceived','normalMode','trigger');connect('normalMode','done','normalAck','trigger');connect('normalMode','failed','normalAck','reject');}
  if(!receiver||combined){add('timer','clex.logic.timer',{intervalMs:5000});radio('send','send',{transferType:'command',peerId:'12345678-1234-4234-8234-123456789abc'});radio('senderMode','control',{action:'mode'});connect('timer','tick','send','trigger');connect('send','completed','senderMode','trigger');}
 }
 return {project:withLogic(p,graph),nodes,component};
}

export function espNowButtonProject(){
 const result=espNowProject({receiver:false}),{nodes}=result;let p=result.project;
 p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.button'),catalog);const button=p.components.find(c=>c.moduleId==='clex.hardware.button');p=connectTerminal(p,catalog,button.id,'signal','P26');p=connectTerminal(p,catalog,button.id,'ground','P33');
 let graph={...p.logic,nodes:p.logic.nodes.filter(n=>n.id!==nodes.timer.id),edges:p.logic.edges.filter(e=>e.source!==nodes.timer.id)};
 graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.gpio-edge'),p.components,p,catalog);const input=graph.nodes.at(-1);input.parameters.componentId=button.id;
 graph=connectNodes(graph,catalog,{source:input.id,sourceHandle:'falling',target:nodes.send.id,targetHandle:'trigger'},{...p,logic:graph});
 graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.espnow-send'),p.components,p,catalog);const normalSend=graph.nodes.at(-1);normalSend.parameters={...nodes.send.parameters,command:'SET_NORMAL'};
 graph=addNode(graph,catalog.modules.find(m=>m.id==='clex.logic.espnow-control'),p.components,p,catalog);const normalMode=graph.nodes.at(-1);normalMode.parameters.action='mode';normalMode.parameters.mode='normal';
 graph=connectNodes(graph,catalog,{source:input.id,sourceHandle:'rising',target:normalSend.id,targetHandle:'trigger'},{...p,logic:graph});graph=connectNodes(graph,catalog,{source:normalSend.id,sourceHandle:'completed',target:normalMode.id,targetHandle:'trigger'},{...p,logic:graph});
 return {...result,project:withLogic(p,graph),button,input};
}
