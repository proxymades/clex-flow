import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {esp32EspNowProject} from './esp32-firmware-fixture.js';
import {stepperProject} from './stepper-fixture.js';
import {temperatureProject} from './temperature-fixture.js';
import {wifiProject} from './wifi-fixture.js';
import {mqttProject} from './mqtt-fixture.js';
import {routerProject} from './router-fixture.js';
import {xgzpProject} from './xgzp-fixture.js';
export const C3_BOARD='esp32-c3-super-mini';
const board=catalog.boards.find(b=>b.id===C3_BOARD),module=id=>catalog.modules.find(m=>m.id===id);
export function c3GpioProject(){
 let p=createProject('ESP32-C3 Super Mini – кнопка и светодиод','',C3_BOARD,{});
 for(const id of ['clex.hardware.led','clex.hardware.button'])p=addHardware(p,module(id),catalog);
 const [led,button]=p.components;
 for(const [component,terminal,pin] of [[led,'anode','R5'],[led,'cathode','R2'],[button,'signal','R4'],[button,'ground','R2']])p=connectTerminal(p,catalog,component.id,terminal,pin);
 for(const id of ['clex.logic.gpio-edge','clex.logic.gpio-set'])p=withLogic(p,addNode(p.logic,module(id),p.components,p,catalog));
 const [input,output]=p.logic.nodes;
 p=withLogic(p,connectNodes(p.logic,catalog,{source:input.id,sourceHandle:'active',target:output.id,targetHandle:'toggle'},p));
 return p;
}
export function c3DisplayProject(){
 let p=c3GpioProject();p=addHardware(p,module('clex.display.spi-240x320'),catalog);const display=p.components.at(-1);
 for(const terminal of ['sclk','mosi','cs','dc','reset']){
  const pin=board.pins.find(pin=>!connectionProblem(p,catalog,display.id,terminal,pin.id));
  if(!pin)throw Error('No free SPI pin for '+terminal);
  p=connectTerminal(p,catalog,display.id,terminal,pin.id);
 }
 for(const [terminal,pin]of [['vcc','R3'],['gnd','R2']])p=connectTerminal(p,catalog,display.id,terminal,pin);
 return p;
}
export function c3Cases(){
 const radio=esp32EspNowProject({combined:true,rememberMode:true,peerHealth:true});radio.boardId=C3_BOARD;
 return [
  ['gpio',c3GpioProject()],['display',c3DisplayProject()],['espnow',radio],
  ...['drv8825','tmc2208','tb6600'].map(driver=>[driver,stepperProject(driver,C3_BOARD).project]),
  ['temperature',temperatureProject(C3_BOARD)],['xgzp',xgzpProject(C3_BOARD).project],
  ['wifi',wifiProject({boardId:C3_BOARD,staticIp:true,mqtt:true}).project],
  ['router',routerProject({boardId:C3_BOARD,ota:false}).project],
  ...['3.1.1','5.0'].map(protocol=>['mqtt-'+protocol,mqttProject({boardId:C3_BOARD,network:'wifi',protocol,tls:true}).project]),
 ];
}
