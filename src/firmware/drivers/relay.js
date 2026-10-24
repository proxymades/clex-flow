import {RELAY_MODULE,relayChannelCount} from '../../relay/model.js';

// One logical state per physical channel, shared by all blocks bound to it.
export function relayFirmware(project,nodes,index,platform){
 const modules=project.components.filter(component=>component.moduleId===RELAY_MODULE).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const slots=new Map(modules.map((component,i)=>[component.id,i]));
 const avr=platform==='arduino-avr',declarations=[],initialize=[],operations=new Map();
 for(const [i,component]of modules.entries()){
  declarations.push(`static bool relay_state_${i}[${relayChannelCount(component)}];`);
  const inactive=component.parameters.activeLevel==='low'?1:0;
  const pins=project.gpioAssignments.filter(assignment=>assignment.componentId===component.id&&/^in\d+$/.test(assignment.terminalId)).sort((a,b)=>Number(a.terminalId.slice(2))-Number(b.terminalId.slice(2)));
  for(const assignment of pins){
   const pin=assignment.gpio,channel=Number(assignment.terminalId.slice(2))-1;
   initialize.push(`  relay_state_${i}[${channel}] = false;`);
   // Preload the inactive output latch before enabling the driver.
   initialize.push(avr?`  digitalWrite(${pin}, ${inactive?'HIGH':'LOW'});
  pinMode(${pin}, OUTPUT);`:`  ESP_ERROR_CHECK(gpio_set_level(${pin}, ${inactive}));
  { gpio_config_t config = { .pin_bit_mask = 1ULL << ${pin}, .mode = GPIO_MODE_OUTPUT, .pull_up_en = GPIO_PULLUP_DISABLE, .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE }; ESP_ERROR_CHECK(gpio_config(&config)); }`);
  }
 }
 for(const node of nodes.filter(node=>node.moduleId==='clex.logic.relay')){
  const component=modules.find(component=>component.id===node.parameters.componentId),slot=slots.get(component?.id),channel=Number(node.parameters.channel)-1;
  const pin=project.gpioAssignments.find(assignment=>assignment.componentId===component?.id&&assignment.terminalId==='in'+node.parameters.channel)?.gpio;
  if(slot===undefined||pin===undefined||channel<0||channel>=relayChannelCount(component))throw Error('Выберите подключенный канал реле.');
  const state=`relay_state_${slot}[${channel}]`,i=index.get(node.id),low=component.parameters.activeLevel==='low';
  declarations.push(`static bool value_${i};`);
  operations.set(node.id,({inputEdge,dataExpression})=>{
   const input=inputEdge(node,'value'),action=node.parameters.action;
   const value=action==='on'?'true':action==='off'?'false':action==='toggle'?'!'+state:input?dataExpression(input):node.parameters.defaultValue?'true':'false';
   const level=low?'!'+state:state;
   return `  ${state} = ${value};
`+(avr?`  digitalWrite(${pin}, ${level} ? HIGH : LOW);`:`  ESP_ERROR_CHECK(gpio_set_level(${pin}, ${level}));`)+`
  value_${i} = ${state};`;
  });
 }
 return {declarations:declarations.join('\n'),initialize:initialize.join('\n'),operations};
}
