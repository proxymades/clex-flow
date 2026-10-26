export const XGZP_MODULE = 'clex.hardware.xgzp6847d';
export const XGZP_LOGIC = 'clex.logic.xgzp6847d';
export const isXgzp = component => component?.moduleId === XGZP_MODULE;
export const i2cSignals = (component, project) => Object.fromEntries(project.gpioAssignments.filter(a => a.componentId === component.id && ['sda','scl'].includes(a.terminalId)).map(a => [a.terminalId,a.gpio]));
export function externalI2cBuses(project) {
  return project.components.filter(isXgzp).map(component => ({componentId:component.id,name:component.name,port:Number(component.parameters.i2cPort),...i2cSignals(component,project)}));
}
export function xgzpSupplyProblem(component, board) {
  if (!isXgzp(component) || Number(component.parameters.supplyVoltage) === (board.logicVoltage || 3.3)) return null;
  return board.logicVoltage === 5
    ? 'Для этой платы XGZP6847D подключается к питанию и подтяжкам I²C 5 В. Выберите питание 5 В.'
    : 'На ESP32 XGZP6847D подключается только к питанию и подтяжкам I²C 3,3 В. Питание 5 В недопустимо.';
}
export function xgzpPowerProblem(component, pin, board) {
  if (!isXgzp(component)) return null;
  const voltage = board.logicVoltage || 3.3;
  if (pin.kind !== 'power' || pin.voltage !== voltage) return voltage === 5
    ? 'Подключите VDD датчика к контакту питания 5 В.'
    : 'На ESP32 VDD датчика можно подключить только к контакту питания 3,3 В.';
  return xgzpSupplyProblem(component, board);
}
export function i2cConnectionProblem(component, terminal, pin, board) {
  if (!isXgzp(component) || !['sda','scl'].includes(terminal.id)) return null;
  const voltageProblem = xgzpSupplyProblem(component, board);
  if (voltageProblem) return voltageProblem;
  if (!pin.capabilities?.includes('digital-input') || !pin.capabilities?.includes('digital-output')) return 'I²C требует GPIO с цифровым входом и выходом.';
  if (board.platform === 'arduino-avr' && pin.gpio !== (terminal.id === 'sda' ? 18 : 19)) return terminal.id === 'sda' ? 'На Nano SDA подключается к A4.' : 'На Nano SCL подключается к A5.';
  return null;
}
export function i2cClaimAllows(component, terminalId, pin, claim) {
  if (!isXgzp(component) || !['sda','scl'].includes(terminalId)) return false;
  return claim.key === 'i2c:' + component.parameters.i2cPort && (claim.componentId === component.id || claim.configuration?.[terminalId] === pin.gpio);
}
export function xgzpIssues(component, project, board) {
  if (!isXgzp(component)) return [];
  const issues = [];
  const voltageProblem = xgzpSupplyProblem(component, board);
  if (voltageProblem) issues.push(voltageProblem);
  if (!['4','8','16','32','64','128','256','512','1024','2048','4096','8192'].includes(component.parameters.kFactor)) issues.push('Выберите коэффициент K по диапазону и документации датчика.');
  if (board.platform === 'arduino-avr' && component.parameters.i2cPort !== '0') issues.push('На Arduino Nano доступен один контроллер I²C (Wire).');
  if (project.components.some(c => c.id !== component.id && isXgzp(c) && c.parameters.i2cPort === component.parameters.i2cPort)) issues.push('Адрес 0x6D уже занят другим XGZP6847D на этой шине. Выберите другой контроллер I²C.');
  const {sda,scl} = i2cSignals(component,project);
  if (sda !== undefined && sda === scl) issues.push('SDA и SCL должны использовать разные GPIO.');
  return issues;
}

// Preserve saved mounting and logic links when opening the initial sensor profile.
export function migrateXgzpProject(project) {
  const aliases={'clex.hardware.xgzp6897d':XGZP_MODULE,'clex.logic.xgzp6897d':XGZP_LOGIC};
  if(project.formatVersion!==3 || !Array.isArray(project.components) || !Array.isArray(project.logic?.nodes) || !project.moduleVersions)return project;
  const migrated=new Set();
  const entry=item=>{
    const id=Object.hasOwn(aliases,item?.moduleId)?aliases[item.moduleId]:null;
    if(!id || item.moduleVersion!=='1.0.0')return item;
    migrated.add(item.moduleId);
    const name=typeof item.name==='string' && /^XGZP6897D(?: – Измерение)? \d+$/.test(item.name)?item.name.replace('XGZP6897D','XGZP6847D'):item.name;
    return {...item,moduleId:id,name};
  };
  const components=project.components.map(entry),nodes=project.logic.nodes.map(entry);
  if(!migrated.size)return project;
  const moduleVersions={...project.moduleVersions};
  for(const legacy of migrated){
    const id=aliases[legacy];
    if(moduleVersions[id] && moduleVersions[id]!==moduleVersions[legacy])throw new Error('В проекте нельзя смешивать версии одного модуля.');
    moduleVersions[id]=moduleVersions[legacy];
    if(![...components,...nodes].some(item=>item.moduleId===legacy))delete moduleVersions[legacy];
  }
  return {...project,components,logic:{...project.logic,nodes},moduleVersions};
}
