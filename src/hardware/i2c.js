export function i2cPorts(board) {
  if (!board) return [];
  return ['esp32c3', 'atmega328p'].includes(board.target) ? ['0'] : ['0', '1'];
}

export function i2cSignals(component, project) {
  return Object.fromEntries(project.gpioAssignments
    .filter(assignment => assignment.componentId === component.id && ['sda', 'scl'].includes(assignment.terminalId))
    .map(assignment => [assignment.terminalId, assignment.gpio]));
}

export function externalI2cBuses(project, catalog) {
  return project.components.filter(component => catalog.modules.find(module => module.id === component.moduleId)?.i2c)
    .map(component => ({
      componentId: component.id,
      name: component.name,
      port: Number(component.parameters.i2cPort),
      ...i2cSignals(component, project),
    }));
}

export function i2cAddress(component, module) {
  return module.i2c.addressParameter ? Number(component.parameters[module.i2c.addressParameter]) : module.i2c.address;
}

export function i2cConnectionProblem(module, terminalId, pin, board) {
  if (!module.i2c || !['sda', 'scl'].includes(terminalId)) return null;
  if (!pin.capabilities?.includes('digital-input') || !pin.capabilities?.includes('digital-output')) {
    return 'I²C требует GPIO с цифровым входом и выходом.';
  }
  if (board.platform === 'arduino-avr' && pin.gpio !== (terminalId === 'sda' ? 18 : 19)) {
    return terminalId === 'sda' ? 'На Nano SDA подключается к A4.' : 'На Nano SCL подключается к A5.';
  }
  return null;
}

export function i2cClaimAllows(component, module, terminalId, pin, claim) {
  if (!module.i2c || !['sda', 'scl'].includes(terminalId) || claim.key !== 'i2c:' + component.parameters.i2cPort) return false;
  return claim.componentId === component.id || claim.share === 'bus' && claim.configuration?.[terminalId] === pin.gpio;
}

export function i2cIssues(component, module, project, catalog, board) {
  if (!module.i2c) return [];
  const issues = [];
  if (!i2cPorts(board).includes(component.parameters.i2cPort)) {
    issues.push(board.platform === 'arduino-avr'
      ? 'На Arduino Nano доступен один контроллер I²C (Wire).'
      : 'Выберите доступный контроллер I²C.');
  }
  const address = i2cAddress(component, module);
  const duplicate = project.components.find(other => {
    if (other.id === component.id || other.parameters.i2cPort !== component.parameters.i2cPort) return false;
    const definition = catalog.modules.find(item => item.id === other.moduleId);
    return definition?.i2c && i2cAddress(other, definition) === address;
  });
  if (duplicate) {
    issues.push('Адрес 0x' + address.toString(16).toUpperCase() + ' уже занят компонентом «' + duplicate.name + '» на этой шине.');
  }
  const {sda, scl} = i2cSignals(component, project);
  if (sda !== undefined && sda === scl) issues.push('SDA и SCL должны использовать разные GPIO.');
  return issues;
}
