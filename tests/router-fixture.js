import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {displayProject} from './display-fixture.js';
export function routerProject({boardId='waveshare-esp32-s3-eth',wan='wifi',lan='softap',backup='none',staticWan=false,ota=true}={}){
 let project=createProject('Wi-Fi маршрутизатор','',boardId,boardId.includes('p4')?{chipRevision:'pre-v3'}:{camera:'disconnected'});
 if(wan==='ethernet'||lan==='ethernet'||backup==='ethernet')project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.ethernet'),catalog);
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.router'),catalog);const router=project.components.at(-1);
 Object.assign(router.parameters,{otaEnabled:ota,wanSource:wan,lanSource:lan,backupWan:backup,staSsid:'CLEX-Test-WAN',staPassword:'temporary-wan-key',adminPassword:'temporary-admin-key',apPassword:'temporary-lan-key'});
 if(staticWan){Object.assign(router.parameters,{staAddressMode:'static',staIp:'192.168.10.20',staMask:'255.255.255.0',staGateway:'192.168.10.1',staDns:'1.1.1.1'});const eth=project.components.find(c=>c.moduleId==='clex.hardware.ethernet');if(eth)Object.assign(eth.parameters,{addressMode:'static',staticIp:'192.168.20.20',netmask:'255.255.255.0',gateway:'192.168.20.1',dns:'1.1.1.1'});}
 project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.router'),project.components,project,catalog));
 return {project,router,node:project.logic.nodes.at(-1)};
}
export function routerDisplayProject(){
 let project=displayProject();
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.ethernet'),catalog);
 project=addHardware(project,catalog.modules.find(m=>m.id==='clex.hardware.router'),catalog);const router=project.components.at(-1);router.parameters.wanSource='ethernet';
 project=withLogic(project,addNode(project.logic,catalog.modules.find(m=>m.id==='clex.logic.router'),project.components,project,catalog));const node=project.logic.nodes.at(-1),view=project.logic.nodes.find(n=>n.moduleId==='clex.logic.display'),screen=project.screens[project.components[0].id];
 const field=screen.elements[0];Object.assign(field,{mode:'dynamic',valueType:'text',initialValue:'',prefix:'WAN: ',suffix:''});
 for(const [sourceHandle,targetHandle] of [['changed','trigger'],['wanIp',field.id]])project=withLogic(project,connectNodes(project.logic,catalog,{source:node.id,sourceHandle,target:view.id,targetHandle},project));
 return {project,router,node};
}
