import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,withLogic} from '../src/logic/model.js';
export function wifiProject({boardId='waveshare-esp32-s3-eth',staticIp=false,logic=true,mqtt=false,autoConnect=true}={}){
 const board=catalog.boards.find(board=>board.id===boardId),module=id=>catalog.modules.find(module=>module.id===id);
 const settings=Object.fromEntries(Object.entries(board.options||{}).map(([key,option])=>[key,option.default]));
 if(boardId==='waveshare-esp32-s3-eth')settings.camera='disconnected';
 let project=addHardware(createProject('Wi-Fi','',boardId,settings),module('clex.hardware.wifi'),catalog);
 const wifi=project.components.at(-1);
 Object.assign(wifi.parameters,{ssid:'CLEX-Fixture-WiFi',password:'temporary-wifi-key',autoConnect});
 if(staticIp)Object.assign(wifi.parameters,{addressMode:'static',staticIp:'192.0.2.20',netmask:'255.255.255.0',gateway:'192.0.2.1',dns:'192.0.2.53'});
 if(logic)project=withLogic(project,addNode(project.logic,module('clex.logic.wifi'),project.components,project,catalog));
 if(mqtt){
  project=addHardware(project,module('clex.hardware.mqtt'),catalog);
  Object.assign(project.components.at(-1).parameters,{networkId:wifi.id,host:'broker.example.test',clientId:'wifi-fixture',tls:true,port:8883});
 }
 return {project,wifi,node:project.logic.nodes.find(node=>node.moduleId==='clex.logic.wifi')};
}
