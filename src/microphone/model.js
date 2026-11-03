export const MICROPHONE_MODULES=['clex.hardware.max9814','clex.hardware.max4466','clex.hardware.inmp441'];
export const isMicrophone=c=>MICROPHONE_MODULES.includes(c?.moduleId);
export const isAnalogMicrophone=c=>isMicrophone(c)&&c.moduleId!=='clex.hardware.inmp441';
export const voiceSupported=board=>['esp32p4','esp32s3'].includes(board?.target)&&board.voice?.psramMb>=8;
export function microphonePin(project,component,terminal,board){
  const wire=project.assembly.connections.find(w=>w.componentId===component.id&&w.terminalId===terminal&&!w.sourceComponentId);
  return board?.pins.find(p=>p.id===wire?.boardPinId);
}
export function microphoneSource(project,voice,board){
  const component=project.components.find(c=>c.id===voice.parameters.microphoneId&&isMicrophone(c));
  if(!voice.parameters.microphoneId){const provider=board?.peripherals?.find(p=>p.id===voice.parameters.interfaceId&&p.driverKey==='es8311-i2s'&&Number.isInteger(p.signals?.din));return provider?{kind:'codec',provider,key:''}:null;}
  if(!component)return null;
  if(isAnalogMicrophone(component)){
    const pin=microphonePin(project,component,'out',board);
    return {kind:'adc',component,gpio:pin?.gpio,channel:pin?.adc?.channel,key:component.id+':adc:'+pin?.gpio};
  }
  const pins=Object.fromEntries(['bclk','ws','sd'].map(id=>[id,microphonePin(project,component,id,board)?.gpio]));
  return {kind:'i2s',component,...pins,port:Number(component.parameters.i2sPort),right:component.parameters.channel==='right',key:component.id+':i2s:'+JSON.stringify([component.parameters.i2sPort,component.parameters.channel,pins])};
}
export function microphoneConnectionProblem(component,terminal,pin){
  if(!isMicrophone(component))return null;
  if(terminal.id==='power')return pin.kind==='power'&&pin.voltage===3.3?null:'Микрофон подключается к питанию 3,3 В. Питание 5 В в этой конфигурации недопустимо.';
  if(terminal.id==='lr')return component.parameters.channel==='right'?(pin.kind==='power'&&pin.voltage===3.3?null:'Для правого канала подключите L/R к 3,3 В.'):(pin.kind==='ground'?null:'Для левого канала подключите L/R к GND.');
  if(isAnalogMicrophone(component)&&terminal.id==='out'&&(!pin.adc||pin.adc.unit!==1))return 'OUT аналогового микрофона подключается к свободному входу ADC1.';
  return null;
}
export function microphoneIssues(component,project,board){
  if(!isMicrophone(component))return [];
  if(isAnalogMicrophone(component))return component.parameters.supplyVoltage==='3.3'?[]:['Для микрофона на ESP32 выберите питание 3,3 В.'];
  const issues=[];
  if(!board.interfaces?.i2s?.hosts.includes(Number(component.parameters.i2sPort)))issues.push('Выберите поддерживаемый контроллер I²S.');
  if(!['left','right'].includes(component.parameters.channel))issues.push('Выберите левый или правый канал I²S.');
  return issues;
}
export function microphoneClaims(project,board){
  return project.components.filter(isMicrophone).map(component=>{
    const gpios=(isAnalogMicrophone(component)?['out']:['bclk','ws','sd']).map(t=>microphonePin(project,component,t,board)?.gpio).filter(Number.isInteger);
    return {key:isAnalogMicrophone(component)?'adc:1':'i2s:'+component.parameters.i2sPort,label:isAnalogMicrophone(component)?'ADC1':'I²S'+component.parameters.i2sPort,gpios,componentId:component.id,name:component.name};
  });
}
