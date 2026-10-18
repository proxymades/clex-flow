export const STEPPER_DRIVERS=['clex.hardware.tb6600','clex.hardware.tmc2208','clex.hardware.drv8825'];
export const isStepperDriver=component=>STEPPER_DRIVERS.includes(component?.moduleId);
export function stepperIssues(project){
 const issues=[];
 const drivers=project.components.filter(isStepperDriver);
 if(drivers.length>2)issues.push({severity:'error',code:'stepper-count',message:'Поддерживается до двух шаговых драйверов: по одному аппаратному таймеру на двигатель.'});
 for(const driver of drivers){
  if(!Number.isInteger(driver.parameters.pulseUs))issues.push({severity:'error',code:'stepper-pulse',componentId:driver.id,message:driver.name+': длительность импульса должна быть целым числом микросекунд.'});
  const wires=project.assembly.connections.filter(w=>w.sourceComponentId===driver.id);
  const motors=new Set(wires.filter(w=>['a1','a2','b1','b2'].includes(w.sourceTerminalId)).map(w=>w.componentId));
  if(motors.size>1)issues.push({severity:'error',code:'stepper-motor',componentId:driver.id,message:driver.name+': четыре выхода обмоток должны подключаться к одному двигателю.'});
 }
 for(const motor of project.components.filter(c=>c.moduleId==='clex.hardware.nema17'))if(!Number.isInteger(motor.parameters.stepsPerRevolution))issues.push({severity:'error',code:'stepper-resolution',componentId:motor.id,message:motor.name+': число полных шагов на оборот должно быть целым.'});
 return issues;
}
export function stepperLogicIssues(node,project){
 if(node.moduleId!=='clex.logic.stepper')return [];
 const driver=project.components.find(c=>c.id===node.parameters.componentId);if(!isStepperDriver(driver))return ['Выберите шаговый драйвер из монтажа.'];
 if(node.parameters.motion==='revolutions'){
  const value=node.parameters.revolutions;if(!Number.isFinite(value)||value<0.001||value>10000)return ['Количество оборотов должно быть от 0,001 до 10000.'];
  const motorId=project.assembly.connections.find(w=>w.sourceComponentId===driver.id&&w.sourceTerminalId==='a1')?.componentId,motor=project.components.find(c=>c.id===motorId);
  if(motor){const count=Math.round(value*motor.parameters.stepsPerRevolution*Number(driver.parameters.microsteps));if(count<1||count>10000000)return ['Движение должно содержать 1-10000000 импульсов STEP с учетом микрошагов.'];}
 }
 return [];
}
