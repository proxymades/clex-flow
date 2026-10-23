import {isStepperDriver} from '../../stepper/model.js';
import {STEPPER_RUNTIME} from './esp-idf/stepper-runtime.js';
import {AVR_STEPPER_RUNTIME} from './arduino-avr/stepper-runtime.js';
export function stepperFirmware(project,nodes,index,board=null){
 const avr=board?.platform==='arduino-avr';
 const drivers=[...project.components].filter(isStepperDriver).sort((a,b)=>a.id<b.id?-1:1),blocks=nodes.filter(n=>n.moduleId==='clex.logic.stepper');
 const empty={enabled:false,headers:'',source:'',notify:'',initialize:'',poll:'',expressions:new Map(),textSizes:new Map(),textGlyphs:new Map(),operations:new Map(),extraFunctions:new Map()};
 if(!drivers.length)return empty;
 const expressions=new Map(),textSizes=new Map(),textGlyphs=new Map(),operations=new Map(),extraFunctions=new Map();
 const configs=drivers.map(c=>{const pin=id=>{const a=project.gpioAssignments.find(a=>a.componentId===c.id&&a.terminalId===id);if(!a)throw Error(c.name+': подключите '+id);return a.gpio;};return `{.step=${pin('step')},.dir=${pin('dir')},.enable=${pin('enable')},.enable_high=${c.parameters.enableLevel==='high'},.invert_direction=${c.parameters.invertDirection==='yes'},.pulse_us=${c.parameters.pulseUs}}`;});
 let declarations='',notify='static void clex_sp_notify(unsigned driver,unsigned owner,unsigned events,clex_sp_snapshot_t value){\n (void)driver;(void)owner;(void)events;(void)value;\n';
 for(const node of blocks){
  const i=index.get(node.id),id=drivers.findIndex(c=>c.id===node.parameters.componentId),c=drivers[id],name='stepper_value_'+i,p=node.parameters;
  const motorId=project.assembly.connections.find(w=>w.sourceComponentId===c.id&&w.sourceTerminalId==='a1')?.componentId,motor=project.components.find(c=>c.id===motorId);
  const count=p.motion==='continuous'?0:p.motion==='revolutions'?Math.round(p.revolutions*motor.parameters.stepsPerRevolution*Number(c.parameters.microsteps)):p.steps;
  if(!Number.isInteger(count)||count<0||count>10000000||(!count&&p.motion!=='continuous'))throw Error(node.name+': движение должно содержать 1-10000000 импульсов.');
  declarations+=`static clex_sp_snapshot_t ${name};\n`;
  expressions.set(node.id,Object.fromEntries(['moving','enabled','position','emitted','error'].map(key=>[key,name+'.'+key])));textSizes.set(node.id,{error:128});
  textGlyphs.set(node.id,[...STEPPER_RUNTIME.matchAll(/return "([^"]*)"/g)].map(match=>match[1]).join(' '));
  operations.set(node.id,`  {unsigned error=clex_sp_start(${id},${i},${count},${p.direction==='reverse'},${p.speed},${p.acceleration});${name}=clex_sp_read(${id});if(error){${avr?`${name}.error=clex_sp_error(error);`:`snprintf(${name}.error,sizeof(${name}.error),"%s",clex_sp_error(error));`}node_${i}_emit_changed();node_${i}_emit_failed();}else{node_${i}_emit_changed();node_${i}_emit_started();}}`);
  extraFunctions.set(node.id,['stop','release'].map(action=>`static void node_${i}_${action}(void){clex_sp_stop(${id},${i},${action==='release'});}\n`).join(''));
  notify+=` if(driver==${id}){${name}=value;node_${i}_emit_changed();if(owner==${i}){if(events&SP_DONE)node_${i}_emit_completed();if(events&SP_STOPPED)node_${i}_emit_stopped();if(events&SP_ERROR)node_${i}_emit_failed();}}\n`;
 }
 notify+='}\n';
 const runtime=(avr?AVR_STEPPER_RUNTIME:STEPPER_RUNTIME).replaceAll('@COUNT@',String(drivers.length)).replace('@CONFIG@','{'+configs.join(',')+'}').replace('@DRIVER_LIMIT@',String(board?.motion?.maxDrivers||0)).replace('@MAX_SPEED@',String(board?.motion?.maxSpeed||0)).replace('@MAX_TOTAL_SPEED@',String(board?.motion?.maxTotalSpeed||0));
 return {...empty,enabled:true,headers:avr?'':'#include "driver/gptimer.h"',source:runtime+'\n'+declarations,notify,initialize:'  clex_sp_initialize();',poll:'    clex_sp_poll();',expressions,textSizes,textGlyphs,operations,extraFunctions};
}
