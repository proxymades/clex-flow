import {OUTPUT_MODULE,outputChannelCount,outputTerminals,outputTerminalId} from '../../gpio/model.js';
export const gpioStateName=(component,index,channel)=>`gpio_state_${index}${outputChannelCount(component)?'_in'+channel:''}`;
export const gpioOutputLevel=(component,state)=>component?.parameters?.activeLevel==='low'?'!'+state:state;
// Only connected terminals consume GPIO state or initialization code.
export function gpioOutputFirmware(project,components,platform,catalog,nodes){
 const declarations=[],initialize=[],operations=new Map(),avr=platform==='arduino-avr';
 for(const [i,component] of components.entries()){
  if(component.moduleId==='clex.hardware.relay')continue;
  const terminals=outputTerminals(component,catalog),ids=new Set(terminals.map(t=>t.id));
  const pins=project.gpioAssignments.filter(a=>a.componentId===component.id&&ids.has(a.terminalId)).sort((a,b)=>a.terminalId.localeCompare(b.terminalId,'en',{numeric:true}));
  for(const pin of pins){
   const channel=terminals.find(t=>t.id===pin.terminalId)?.channel,state=gpioStateName(component,i,channel),inactive=component.parameters.activeLevel==='low'?1:0;
   declarations.push(`static bool ${state};`);
   initialize.push(avr?`  digitalWrite(${pin.gpio}, ${inactive?'HIGH':'LOW'});
  pinMode(${pin.gpio}, OUTPUT);`:`  ESP_ERROR_CHECK(gpio_set_level(${pin.gpio}, ${inactive}));
  { gpio_config_t config = { .pin_bit_mask = 1ULL << ${pin.gpio}, .mode = GPIO_MODE_OUTPUT, .pull_up_en = GPIO_PULLUP_DISABLE, .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE }; ESP_ERROR_CHECK(gpio_config(&config)); }`);
  }
 }
 for(const node of nodes.filter(n=>n.moduleId===OUTPUT_MODULE)){
  const component=components.find(c=>c.id===node.parameters.componentId);
  if(component?.moduleId==='clex.hardware.relay')continue;
  const terminal=outputTerminalId(node,component,catalog),pin=project.gpioAssignments.find(a=>a.componentId===component?.id&&a.terminalId===terminal)?.gpio;
  if(pin===undefined)throw Error('Выберите подключенный выходной компонент и канал.');
  const state=gpioStateName(component,components.indexOf(component),node.parameters.channel),level=gpioOutputLevel(component,state);
  operations.set(node.id,{state,command(action){
   if(!['on','off','toggle'].includes(action))throw Error('Неизвестная команда выхода.');
   const value=action==='on'?'true':action==='off'?'false':'!'+state;
   return `  ${state} = ${value};
`+(avr?`  digitalWrite(${pin}, ${level} ? HIGH : LOW);`:`  ESP_ERROR_CHECK(gpio_set_level(${pin}, ${level}));`);
  }});
 }
 return {declarations:declarations.join('\n'),initialize:initialize.join('\n'),operations};
}
