import {numericFirmware} from '../drivers/numeric.js';
import {NUMERIC_MODULES} from '../../logic/numeric.js';
import {xgzpFirmware} from '../drivers/xgzp6847d.js';
import {relayFirmware} from '../drivers/relay.js';
import {RELAY_MODULE,relayChannelCount} from '../../relay/model.js';
import { stepperFirmware } from '../drivers/stepper.js';
import { isStepperDriver } from '../../stepper/model.js';
import { hardwareBinding } from '../../logic/model.js';
import { selectNumberCode } from '../drivers/select-number.js';
const keys=new Set([...NUMERIC_MODULES,'clex.hardware.xgzp6847d','clex.logic.xgzp6847d','clex.hardware.relay','clex.logic.relay','clex.hardware.nema17','clex.hardware.tb6600','clex.hardware.tmc2208','clex.hardware.drv8825','clex.logic.stepper','clex.logic.select-number','clex.hardware.touch-button','clex.logic.gpio-edge','clex.hardware.led','clex.hardware.button','clex.logic.timer','clex.logic.counter','clex.logic.stopwatch','clex.logic.serial','clex.logic.gpio-read','clex.logic.gpio-set','clex.logic.gpio-toggle']);
export function generateArduinoAvr(project,catalog,board,cString,issues){
 const revision=project.boardSettings.bootloader || board.options.bootloader.default;
 if(!Object.hasOwn(board.firmware.variants,revision))throw new Error('Выберите загрузчик Nano.');
 const sort=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0,nodes=[...project.logic.nodes].sort(sort),components=[...project.components].sort(sort);
 if(nodes.length>32)throw new Error('Для Nano поддерживается до 32 логических блоков из-за объема памяти.');
 for(const entry of [...nodes,...components])if(!keys.has(entry.moduleId)||entry.moduleVersion!=='1.0.0')throw new Error('Для Nano нет реализации блока «'+entry.name+'».');
 const index=new Map(nodes.map((n,i)=>[n.id,i])),hardware=new Map(components.map((c,i)=>[c.id,i]));
 const stepper=stepperFirmware(project,nodes,index,board);
 const xgzp=xgzpFirmware(project,catalog,nodes,index);
 const numeric=numericFirmware(nodes,index,cString);
 const edge=(n,port)=>project.logic.edges.find(e=>e.target===n.id&&e.targetHandle===port);
 const textLengths=new Map();
 const textSize=(n,port='text')=>{if(numeric.textSizes.has(n.id))return numeric.textSizes.get(n.id)[port];if(xgzp.textSizes.has(n.id))return xgzp.textSizes.get(n.id)[port];if(n.moduleId==='clex.logic.stepper')return stepper.textSizes.get(n.id).error;if(n.moduleId==='clex.logic.stopwatch')return 24;if(textLengths.has(n.id))return textLengths.get(n.id);const input=edge(n,'text'),size=(input?textSize(nodes[index.get(input.source)],input.sourceHandle):new TextEncoder().encode(n.parameters.message).length+1)+(edge(n,'number')?((xgzp.expressions.has(edge(n,'number').source)||numeric.expressions.has(edge(n,'number').source))?25:13):0);textLengths.set(n.id,size);return size;};
 for(const n of nodes.filter(n=>n.moduleId==='clex.logic.serial'))textSize(n);
 const watches=nodes.filter(n=>n.moduleId==='clex.logic.stopwatch'),timers=nodes.filter(n=>n.moduleId==='clex.logic.timer');
 const ram=[...textLengths.values()].reduce((a,b)=>a+b,0)+watches.length*48+timers.length*4+nodes.length*4+components.length*10+components.filter(c=>c.moduleId===RELAY_MODULE).reduce((sum,c)=>sum+relayChannelCount(c),0)+components.filter(isStepperDriver).length*96+nodes.filter(n=>n.moduleId==='clex.logic.stepper').length*16;
 if(ram+xgzp.ram+numeric.ram>896)throw new Error('Тексты и блоки требуют слишком много памяти Nano. Сократите сообщения или количество блоков.');
 if(!xgzp.enabled&&!stepper.enabled&&!timers.length&&!watches.length&&!nodes.some(n=>n.moduleId==='clex.logic.gpio-edge'))throw new Error('Добавьте таймер или секундомер для запуска схемы.');
 const data=e=>{
  const n=nodes[index.get(e.source)],i=index.get(n.id);
  if(numeric.expressions.has(n.id))return numeric.expressions.get(n.id)[e.sourceHandle];
  if(xgzp.expressions.has(n.id))return xgzp.expressions.get(n.id)[e.sourceHandle];
  if(stepper.expressions.has(n.id))return stepper.expressions.get(n.id)[e.sourceHandle];
  if(n.moduleId==='clex.logic.stopwatch')return 'watch_'+i+'.'+e.sourceHandle;
  if(n.moduleId==='clex.logic.timer'&&e.sourceHandle==='interval')return String(n.parameters.intervalMs)+'UL';
  if(n.moduleId==='clex.logic.serial')return 'text_'+i;
  return 'value_'+i;
 };
 const call=e=>'node_'+index.get(e.target)+(e.targetHandle==='reset'?'_reset':e.targetHandle==='pause'?'_pause':e.targetHandle==='stop'?'_stop':e.targetHandle==='release'?'_release':'')+'();';
 const emit=(n,port=null)=>project.logic.edges.filter(e=>e.source===n.id&&e.dataType==='event'&&(!port||e.sourceHandle===port)).sort((a,b)=>index.get(a.target)-index.get(b.target)||a.targetHandle.localeCompare(b.targetHandle)).map(e=>'  '+call(e)).join('\n');
 const relay=relayFirmware(project,nodes,index,board.platform);
 const declarations=[relay.declarations].filter(Boolean),initialize=[relay.initialize].filter(Boolean),poll=[];
 components.forEach((c,i)=>{
  if(c.moduleId==='clex.hardware.xgzp6847d'||c.moduleId===RELAY_MODULE||isStepperDriver(c)||catalog.modules.find(m=>m.id===c.moduleId)?.passive)return;
  const assignment=project.gpioAssignments.find(a=>a.componentId===c.id);if(!assignment)throw new Error('Назначьте контакт Nano компоненту «'+c.name+'».');
  const pin=assignment.gpio,output=c.moduleId==='clex.hardware.led',sample='digitalRead('+pin+') '+(c.parameters.activeLevel==='low'?'== LOW':'!= LOW');
  declarations.push(output?'static bool gpio_state_'+i+';':'static bool input_stable_'+i+', input_raw_'+i+';\nstatic uint32_t input_changed_'+i+';');
  initialize.push('  pinMode('+pin+', '+(output?'OUTPUT':c.parameters.pull==='up'?'INPUT_PULLUP':'INPUT')+');');
  if(output)initialize.push('  digitalWrite('+pin+', LOW);');
  else {initialize.push('  input_stable_'+i+' = input_raw_'+i+' = '+sample+'; input_changed_'+i+' = millis();');poll.push('  { bool raw = '+sample+'; if(raw != input_raw_'+i+'){ input_raw_'+i+' = raw; input_changed_'+i+' = now; } if((uint32_t)(now-input_changed_'+i+') >= '+c.parameters.debounceMs+'UL) input_stable_'+i+' = raw; }');}
 });
 nodes.forEach((n,i)=>{
  if(n.moduleId==='clex.logic.gpio-edge'){const h=hardware.get(hardwareBinding(n,project,catalog).component.id);declarations.push('static bool value_'+i+';');initialize.push('  value_'+i+' = input_stable_'+h+';');poll.push('  if(value_'+i+' != input_stable_'+h+'){value_'+i+'=input_stable_'+h+';'+emit(n,'changed')+'if(value_'+i+'){'+emit(n,'rising')+'}else{'+emit(n,'falling')+'}}');}
  if(n.moduleId==='clex.logic.counter')declarations.push('static int32_t value_'+i+' = '+n.parameters.initialValue+'L;');
  if(['clex.logic.gpio-read','clex.logic.gpio-toggle'].includes(n.moduleId))declarations.push('static bool value_'+i+';');
  if(n.moduleId==='clex.logic.serial')declarations.push('static char text_'+i+'['+textSize(n)+'];');
  if(n.moduleId==='clex.logic.timer')declarations.push('static uint32_t timer_'+i+';');
  if(n.moduleId==='clex.logic.stopwatch')declarations.push('static clex_watch_t watch_'+i+';');
 });
 const prototypes=nodes.map((n,i)=>'static void node_'+i+'();'+(n.moduleId==='clex.logic.counter'?'\nstatic void node_'+i+'_reset();':'')+(n.moduleId==='clex.logic.xgzp6847d'?'\n'+['changed','done','failed'].map(port=>'static void node_'+i+'_emit_'+port+'();').join('\n'):'')+(n.moduleId==='clex.logic.stepper'?'\nstatic void node_'+i+'_stop();\nstatic void node_'+i+'_release();\n'+['changed','started','completed','stopped','failed'].map(port=>'static void node_'+i+'_emit_'+port+'();').join('\n'):'')+(n.moduleId==='clex.logic.stopwatch'?'\nstatic void node_'+i+'_pause();\nstatic void node_'+i+'_reset();\nstatic void node_'+i+'_changed();':'')).join('\n');
 const functions=nodes.map((n,i)=>{
  if(numeric.operations.has(n.id))return 'static void node_'+i+'(){\n'+numeric.operations.get(n.id)({inputEdge:edge,dataExpression:data,emit:port=>emit(n,port)})+'\n}';
  if(n.moduleId==='clex.logic.xgzp6847d')return 'static void node_'+i+'(){\n'+xgzp.operations.get(n.id)+'\n}\n'+['changed','done','failed'].map(port=>'static void node_'+i+'_emit_'+port+'(){\n'+emit(n,port)+'\n}').join('\n');
  if(n.moduleId==='clex.logic.stepper')return 'static void node_'+i+'(){\n'+stepper.operations.get(n.id)+'\n}\n'+['changed','started','completed','stopped','failed'].map(port=>'static void node_'+i+'_emit_'+port+'(){\n'+emit(n,port)+'\n}').join('\n');
  if(n.moduleId==='clex.logic.select-number')return 'static void node_'+i+'(){\n'+selectNumberCode(n,data(edge(n,'value')),port=>emit(n,port),true)+'\n}';
  const binding=hardwareBinding(n,project,catalog),h=hardware.get(binding.component?.id),operations=[];
  if(relay.operations.has(n.id))operations.push(relay.operations.get(n.id)({inputEdge:edge,dataExpression:data}));
  if(n.moduleId==='clex.logic.gpio-read')operations.push('  value_'+i+' = input_stable_'+h+';');
  if(n.moduleId==='clex.logic.gpio-set'){const input=edge(n,'value');operations.push('  gpio_state_'+h+' = '+(input?data(input):n.parameters.defaultValue?'true':'false')+';\n  digitalWrite('+binding.gpio+', gpio_state_'+h+' ? HIGH : LOW);');}
  if(n.moduleId==='clex.logic.gpio-toggle')operations.push('  gpio_state_'+h+' = !gpio_state_'+h+';\n  digitalWrite('+binding.gpio+', gpio_state_'+h+' ? HIGH : LOW);\n  value_'+i+' = gpio_state_'+h+';');
  if(n.moduleId==='clex.logic.counter')operations.push('  int64_t next = (int64_t)value_'+i+' + ('+n.parameters.step+'LL);\n  value_'+i+' = next > INT32_MAX ? INT32_MAX : next < INT32_MIN ? INT32_MIN : (int32_t)next;');
  if(n.moduleId==='clex.logic.serial'){
   const text=edge(n,'text'),number=edge(n,'number'),unsigned=number&&(nodes[index.get(number.source)].moduleId==='clex.logic.stopwatch'||nodes[index.get(number.source)].moduleId==='clex.logic.stepper'&&number.sourceHandle==='emitted');
   const flashText=text&&nodes[index.get(text.source)].moduleId==='clex.logic.stepper';
   const decimal=number&&(xgzp.expressions.has(number.source)||numeric.expressions.has(number.source));
   if(decimal)operations.push('  char sensor_number[24]; '+(numeric.expressions.has(number.source)?'dtostre('+data(number)+',sensor_number,6,0);':'dtostrf('+data(number)+',0,3,sensor_number);'));
   const format=(text?(flashText?'%S':'%s'):'%S')+(number?(decimal?' %s':unsigned?' %lu':' %ld'):'');
   operations.push('  snprintf_P(text_'+i+', sizeof(text_'+i+'), PSTR('+cString(format)+'), '+(text?data(text):'PSTR('+cString(n.parameters.message)+')')+(number?decimal?', sensor_number':', ('+(unsigned?'unsigned long':'long')+')('+data(number)+')':'')+');\n  Serial.println(text_'+i+');');
  }
  if(n.moduleId==='clex.logic.stopwatch'){
   const action=command=>'  if(clex_watch_'+command+'(&watch_'+i+', millis())) node_'+i+'_changed();';
   if(n.moduleId==='clex.logic.gpio-edge')return 'static void node_'+i+'(){}';
  return 'static void node_'+i+'(){\n'+action('start')+'\n}\nstatic void node_'+i+'_pause(){\n'+action('pause')+'\n}\nstatic void node_'+i+'_reset(){\n'+action('reset')+'\n}\nstatic void node_'+i+'_changed(){\n'+emit(n,'changed')+'\n}';
  }
  return 'static void node_'+i+'(){\n'+operations.join('\n')+'\n'+emit(n)+'\n}'+(n.moduleId==='clex.logic.counter'?'\nstatic void node_'+i+'_reset(){\n  value_'+i+' = '+n.parameters.initialValue+'L;\n'+emit(n)+'\n}':'');
 });
 const runtime=watches.length?`struct clex_watch_t { uint64_t elapsed; uint32_t sampled, seconds; bool running, dirty; char text[24]; };
static bool clex_watch_refresh(clex_watch_t *w, uint32_t now){
 if(w->running) w->elapsed += (uint32_t)(now-w->sampled);
 w->sampled=now;
 uint64_t elapsed_seconds=w->elapsed/1000ULL;
 uint32_t seconds=elapsed_seconds>UINT32_MAX?UINT32_MAX:(uint32_t)elapsed_seconds;
 if(!w->dirty && seconds==w->seconds)return false;
 w->seconds=seconds; w->dirty=false;
 snprintf_P(w->text,sizeof(w->text),PSTR("%02lu:%02u:%02u"),(unsigned long)(seconds/3600),(unsigned)((seconds/60)%60),(unsigned)(seconds%60));
 return true;
}
static bool clex_watch_start(clex_watch_t *w,uint32_t now){ bool changed=clex_watch_refresh(w,now); if(!w->running){w->running=true;w->dirty=true;} return clex_watch_refresh(w,now) || changed; }
static bool clex_watch_pause(clex_watch_t *w,uint32_t now){ bool changed=clex_watch_refresh(w,now); if(w->running){w->running=false;w->dirty=true;} return clex_watch_refresh(w,now) || changed; }
static bool clex_watch_reset(clex_watch_t *w,uint32_t now){w->elapsed=0;w->sampled=now;w->dirty=true;return clex_watch_refresh(w,now);}
`:'';
 const source=`/* Generated by CLEX Flow for Arduino AVR. */
#include <Arduino.h>
#include <stdint.h>
#include <stdio.h>
#include <avr/pgmspace.h>
${xgzp.headers?xgzp.headers+'\n':''}${runtime}${stepper.source}${xgzp.source?'\n'+xgzp.source:''}${numeric.source?'\n'+numeric.source:''}
${declarations.join('\n')}
${prototypes}
${[...stepper.extraFunctions.values()].join('\n')}${stepper.notify}
${functions.join('\n\n')}
void setup(){
  Serial.begin(115200);
${stepper.initialize}${xgzp.initialize?'\n'+xgzp.initialize:''}
${initialize.join('\n')}
${timers.map(n=>'  timer_'+index.get(n.id)+' = millis();').join('\n')}
${watches.map(n=>'  watch_'+index.get(n.id)+'.running = '+(n.parameters.autoStart?'true':'false')+'; watch_'+index.get(n.id)+'.sampled = millis(); watch_'+index.get(n.id)+'.dirty = true;').join('\n')}
}
void loop(){
  uint32_t now=millis();
${stepper.poll}${xgzp.poll?'\n'+xgzp.poll:''}
${poll.join('\n')}
${timers.map(n=>{const i=index.get(n.id),interval=n.parameters.intervalMs;return '  if((uint32_t)(now-timer_'+i+') >= '+interval+'UL){ timer_'+i+' += ((uint32_t)(now-timer_'+i+')/'+interval+'UL)*'+interval+'UL; node_'+i+'(); }';}).join('\n')}
${watches.map(n=>{const i=index.get(n.id);return '  if(clex_watch_refresh(&watch_'+i+', millis())) node_'+i+'_changed();';}).join('\n')}
}
`;
 return {boardId:board.id,target:board.target,platform:board.platform,boardRevision:revision,consoleMode:'uart',mainC:source,graphicsRuntime:null,networkRuntime:null,featureRuntimes:[],warnings:issues.filter(i=>i.severity==='warning'),files:{'clex_flow/clex_flow.ino':'// The generated runtime is in src/flow.cpp.\n','clex_flow/src/flow.cpp':source}};
}
