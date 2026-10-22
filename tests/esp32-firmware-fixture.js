import {catalog} from './catalog-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {addNode,connectNodes,withLogic} from '../src/logic/model.js';
import {espNowProject} from './espnow-fixture.js';
import {stepperProject} from './stepper-fixture.js';
import {routerProject} from './router-fixture.js';

export const ESP32_BOARD='doit-esp32-devkit-v1-30pin';
const board=()=>catalog.boards.find(b=>b.id===ESP32_BOARD);
const moduleFor=id=>catalog.modules.find(m=>m.id===id);
function hardware(p,id){p=addHardware(p,moduleFor(id),catalog);return [p,p.components.at(-1)];}
function wire(p,c,terminal,pin){return connectTerminal(p,catalog,c.id,terminal,pin.id);}
function ground(){return board().pins.find(p=>p.kind==='ground');}
function gpio(number){return board().pins.find(p=>p.gpio===number);}
function logic(p,ids){let graph=p.logic;const nodes=[];for(const id of ids){graph=addNode(graph,moduleFor(id),p.components,{...p,logic:graph},catalog);nodes.push(graph.nodes.at(-1));}return [withLogic(p,graph),nodes];}
function connect(p,s,sh,t,th){return withLogic(p,connectNodes(p.logic,catalog,{source:s.id,sourceHandle:sh,target:t.id,targetHandle:th},p));}

export function esp32GpioProject({touch=false,inputGpio=26,ledGpio=25}={}){
 let p=createProject('ESP32 DevKit V1 – GPIO','',ESP32_BOARD,{}),led,input;
 [p,led]=hardware(p,'clex.hardware.led');[p,input]=hardware(p,touch?'clex.hardware.touch-button':'clex.hardware.button');
 p=wire(p,led,'anode',gpio(ledGpio));p=wire(p,led,'cathode',ground());
 p=wire(p,input,'signal',gpio(inputGpio));p=wire(p,input,'ground',ground());
 if(touch)p=wire(p,input,'power',board().pins.find(p=>p.kind==='power'&&p.voltage===3.3));
 let nodes;[p,nodes]=logic(p,['clex.logic.timer','clex.logic.gpio-read','clex.logic.gpio-toggle','clex.logic.counter','clex.logic.serial']);
 const [timer,read,toggle,counter,serial]=nodes;read.parameters.componentId=input.id;toggle.parameters.componentId=led.id;
 for(const [s,sh,t,th]of [[timer,'tick',read,'trigger'],[read,'done',toggle,'trigger'],[toggle,'done',counter,'increment'],[counter,'done',serial,'trigger'],[counter,'value',serial,'number']])p=connect(p,s,sh,t,th);
 return p;
}

export function esp32DisplayProject(p=esp32GpioProject(),spiHost='2'){
 let display;[p,display]=hardware(p,'clex.display.spi-240x320');display.parameters.spiHost=spiHost;
 for(const terminal of ['sclk','mosi','cs','dc','reset']){
  const pin=[18,23,27,32,33,16,17,19,21,22,14,13].map(gpio).find(pin=>!connectionProblem(p,catalog,display.id,terminal,pin.id));
  if(!pin)throw Error('No safe display GPIO');p=wire(p,display,terminal,pin);
 }
 p=wire(p,display,'vcc',board().pins.find(p=>p.kind==='power'&&p.voltage===3.3));p=wire(p,display,'gnd',ground());
 let nodes;[p,nodes]=logic(p,['clex.logic.display']);const view=nodes[0];view.parameters.componentId=display.id;
 p.screens={[display.id]:{formatVersion:1,background:'#0b0d14',elements:[{id:'title',type:'text',text:'ESP32 DevKit V1',x:10,y:20,fontId:'montserrat_20',color:'#ffffff'},{id:'value',type:'text',text:'',mode:'dynamic',valueType:'text',initialValue:'Ожидание',prefix:'',suffix:'',x:10,y:65,fontId:'montserrat_14',color:'#38bdf8'}]}};
 const router=p.logic.nodes.find(n=>n.moduleId==='clex.logic.router'),status=p.logic.nodes.find(n=>n.moduleId==='clex.logic.espnow-control'&&n.parameters.action==='status'),serial=p.logic.nodes.find(n=>n.moduleId==='clex.logic.serial');
 const source=router||status||serial;
 p=connect(p,source,router?'wanIp':status?'mac':'text',view,'value');p=connect(p,source,router||status?'changed':'done',view,'update.value');
 return p;
}

export function esp32EspNowProject(options={}){
 const p=espNowProject(options).project;p.boardId=ESP32_BOARD;p.boardSettings={};return p;
}
export function esp32RouterProject({probe=false,display=false}={}){
 let p=routerProject({boardId:ESP32_BOARD,ota:false}).project;p.boardSettings={};
 if(probe){let nodes;[p,nodes]=logic(p,['clex.logic.internet-check']);nodes[0].parameters.url='https://www.espressif.com/';}
 return display?esp32DisplayProject(p):p;
}
function merge(p,other){
 return {...p,components:[...p.components,...other.components],gpioAssignments:[...p.gpioAssignments,...other.gpioAssignments],moduleVersions:{...p.moduleVersions,...other.moduleVersions},logic:{...p.logic,nodes:[...p.logic.nodes,...other.logic.nodes],edges:[...p.logic.edges,...other.logic.edges]},assembly:{...p.assembly,positions:{...other.assembly.positions,...p.assembly.positions},connections:[...p.assembly.connections,...other.assembly.connections]}};
}
export function esp32PeripheralProject(){
 let p=stepperProject('drv8825',ESP32_BOARD).project;p.boardSettings={};
 p=merge(p,esp32EspNowProject({combined:true,rememberMode:true,peerHealth:true}));
 p=merge(p,esp32GpioProject({ledGpio:26,inputGpio:14}));
 return esp32DisplayProject(p,'3');
}
