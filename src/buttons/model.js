export const BUTTON_MODULE = 'clex.hardware.button';
export const BUTTON_BOARD_MODULE = 'clex.hardware.button-module';
export const isButton = component => [BUTTON_MODULE, BUTTON_BOARD_MODULE].includes(component?.moduleId);
export const pullDirection = component => /(?:^|-)down$/.test(component?.parameters?.pull || '') ? 'down' : 'up';
export const internalPull = component => ['up', 'down'].includes(component?.parameters?.pull) ? component.parameters.pull : null;
export const inputActiveLow = component => component?.moduleId === BUTTON_MODULE ? pullDirection(component) === 'up' : component?.parameters?.activeLevel === 'low';

export function resolveButtonModule(component, module) {
  if (component?.moduleId !== BUTTON_MODULE || !module) return module;
  const down = pullDirection(component) === 'down';
  return { ...module, terminals: module.terminals.map(terminal => terminal.id === 'ground' ? {
    ...terminal, label: down ? 'Общий / питание логики' : 'Общий / GND',
    kind: down ? 'power' : 'ground', ...(down ? { voltageFromBoard: true } : {}),
  } : terminal) };
}

export function buttonIssues(component, board, model) {
  if (!isButton(component)) return [];
  const issues = [], pull = component.parameters.pull, direction = pullDirection(component);
  const add = (severity, code, message) => issues.push({ severity, code, message: component.name + ': ' + message, componentId: component.id });
  const pin = model.signalPin(component, 'signal');
  if (internalPull(component) === 'down' && board.platform === 'arduino-avr') add('error', 'button-pull', 'у этой платы нет внутренней подтяжки вниз. Выберите внешний резистор.');
  if (component.moduleId === BUTTON_BOARD_MODULE && internalPull(component) && inputActiveLow(component) !== (direction === 'up')) add('error', 'button-active-level', 'уровень при нажатии должен быть противоположен направлению подтяжки.');
  if (component.moduleId === BUTTON_BOARD_MODULE && pull?.startsWith('external-') && inputActiveLow(component) !== (direction === 'up')) add('error', 'button-active-level', 'уровень при нажатии должен быть противоположен направлению внешней подтяжки.');
  const common = model.pins(component.id, 'ground');
  const poweredCommon = component.moduleId === BUTTON_MODULE && direction === 'down';
  if (!common.some(pin => poweredCommon ? pin.kind === 'power' && pin.voltage === (board.logicVoltage || 3.3) : pin.kind === 'ground')) add('error', 'button-common', poweredCommon ? 'подключите общий контакт к питанию логики платы.' : 'подключите общий контакт к GND.');
  if(component.moduleId===BUTTON_BOARD_MODULE&&!model.pins(component.id,'power').some(pin=>pin.kind==='power'&&pin.voltage===Number(component.parameters.supplyVoltage)))add('error','button-power','подключите VCC к выбранному питанию.');
  const paths = model.attached(component.id, 'signal').filter(path => !path.bypassed);
  for (const path of paths) {
    if (path.pins.some(pin => pin.kind === 'power' && pin.voltage > (board.logicVoltage || 3.3))) add('error', 'button-pull-voltage', 'резистор подтяжки подключён к напряжению выше допустимого для GPIO платы.');
  }
  if ((internalPull(component)||pull?.startsWith('external-'))&&paths.some(path=>path.pins.some(pin=>direction==='up'?pin.kind==='ground':pin.kind==='power'))) add('error','button-pull-direction','резистор подключён в сторону, противоположную выбранной подтяжке.');
  if (pull?.startsWith('external-') && pin) {
    const voltage = board.logicVoltage || 3.3;
    const valid = paths.filter(path => path.pins.length && path.pins.every(pin => direction === 'up' ? pin.kind === 'power' && pin.voltage === voltage : pin.kind === 'ground'));
    if (!valid.length) add('error', 'button-pull-resistor', 'подключите резистор между сигнальной цепью и ' + (direction === 'up' ? 'питанием логики платы.' : 'GND.'));
    for (const path of valid) {
      const ohms = path.resistor.parameters.resistanceOhms;
      if (Number.isFinite(ohms) && (ohms < 1000 || ohms > 100000)) add('error', 'button-pull-resistance', 'для внешней подтяжки поддерживается сопротивление от 1 до 100 кОм.');
    }
  }
  return issues;
}
