import {catalog} from './catalog-fixture.js';
import {relayProject} from './relay-fixture.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';

export const NUMERIC_BOARDS=['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'];
export function numericProject(boardId=NUMERIC_BOARDS[0],{mqtt=false,mode='range'}={}) {
 const module=id=>catalog.modules.find(m=>m.id==='clex.'+id);
 let {project,component}=relayProject({boardId,channels:'2',powerSource:'external'});
 project=withLogic(project,{nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}});
 const nodes={};
 const add=(key,id,parameters={})=>{
  project=withLogic(project,addNode(project.logic,module('logic.'+id),project.components,project,catalog));
  nodes[key]=project.logic.nodes.at(-1);Object.assign(nodes[key].parameters,parameters);
 };
 if(mqtt) {
  project=addHardware(project,module('hardware.wifi'),catalog);
  const wifi=project.components.at(-1);Object.assign(wifi.parameters,{ssid:'CLEX Test',password:'local-test-network'});
  project=addHardware(project,module('hardware.mqtt'),catalog);
  const connection=project.components.at(-1);Object.assign(connection.parameters,{networkId:wifi.id,host:'broker.example.com'});
  add('source','mqtt-receive',{componentId:connection.id,filters:JSON.stringify([{topic:'clex/test/value',qos:1}])});
 } else {
  add('timer','timer',{intervalMs:5000});add('source','serial',{message:'-12000.0 Па'});
 }
 add('parse','text-to-number',{format:'affixes',suffix:'Па'});
 add('condition','compare-number',{mode,lower:-10000,upper:10000});
 add('low','relay',{componentId:component.id,channel:'1',action:'set'});
 add('high','relay',{componentId:component.id,channel:'2',action:'set'});
 const link=(from,output,to,input)=>{project=withLogic(project,connectNodes(project.logic,catalog,{source:nodes[from].id,sourceHandle:output,target:nodes[to].id,targetHandle:input},project));};
 if(!mqtt)link('timer','tick','source','trigger');
 link('source',mqtt?'received':'done','parse','trigger');link('source',mqtt?'payload':'text','parse','text');
 link('parse','changed','condition','trigger');link('parse','value','condition','value');
 link('condition','changed','low','trigger');link('condition','changed','high','trigger');
 if(mode==='range'){link('condition','isBelow','low','value');link('condition','isAbove','high','value');}
 else link('condition','result','low','value');
 for(const [key,x,y]of [['timer',-300,0],['source',0,0],['parse',360,0],['condition',720,0],['low',1120,0],['high',1120,390]])if(nodes[key])nodes[key].position={x,y};
 return {project,nodes,component};
}
