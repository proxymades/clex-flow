import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {routerProject} from './router-fixture.js';
const module=id=>catalog.modules.find(module=>module.id===id);
export function mqttProject({boardId='waveshare-esp32-s3-eth',network='ethernet',protocol='5.0',clients=1,control=true,nodes=true,tls=false}={}){
 let project=network==='wifi'?routerProject({boardId,ota:false}).project:createProject('MQTT','',boardId,boardId.includes('p4')?{chipRevision:'pre-v3'}:{camera:'disconnected'});
 project.boardSettings=Object.fromEntries(Object.entries(catalog.boards.find(board=>board.id===boardId).options||{}).map(([key,option])=>[key,option.default]));
 if(boardId==='waveshare-esp32-s3-eth')project.boardSettings.camera='disconnected';
 project.logic={nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}};
 if(network==='ethernet')project=addHardware(project,module('clex.hardware.ethernet'),catalog);
 const connections=[],blocks=[];
 for(let i=0;i<clients;i++){
  project=addHardware(project,module('clex.hardware.mqtt'),catalog);const connection=project.components.at(-1);connections.push(connection);
  Object.assign(connection.parameters,{host:'localhost',protocol,tls,port:tls?8883:1883,networkId:project.components.find(c=>c.moduleId==='clex.hardware.'+(network==='wifi'?'router':'ethernet')).id});
  if(!nodes)continue;
  const batch={};
  for(const kind of [...(control?['control']:[]),'send','receive']){
   project=withLogic(project,addNode(project.logic,module('clex.logic.mqtt-'+kind),project.components,project,catalog));
   const node=project.logic.nodes.at(-1);node.parameters.componentId=connection.id;batch[kind]=node;
  }
  Object.assign(batch.send.parameters,{topic:'clex/'+i,payload:'MQTT',qos:'2'});
  batch.receive.parameters.filters=JSON.stringify([{topic:'clex/+',qos:1},{topic:'events/#',qos:2}]);
  if(batch.control)project=withLogic(project,connectNodes(project.logic,catalog,{source:batch.control.id,sourceHandle:'connected',target:batch.send.id,targetHandle:'trigger'},project));
  blocks.push(batch);
 }
 return {project,connections,blocks};
}
