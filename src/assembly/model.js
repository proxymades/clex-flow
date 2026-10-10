export const DEFAULT_BOARD_POSITION = { x: 100, y: 40 };
export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
const lookup = (items, id) => items.find(item => item.id === id);
export const boardFor = (project, catalog) => lookup(catalog.boards, project.boardId);
export const moduleFor = (component, catalog) => lookup(catalog.modules, component.moduleId);

export function moduleProblem(component, catalog, board = null) {
  const module = moduleFor(component, catalog);
  if (!module) return 'Модуль не установлен в библиотеке.';
  if (module.version !== component.moduleVersion) return `Требуется модуль ${component.moduleId} версии ${component.moduleVersion}; установлен ${module.version}.`;
  if (board && module.compatibility.espIdf !== board.espIdfVersion) return 'Модуль несовместим с целевой версией ESP-IDF платы.';
  if (module.kind !== 'hardware' || module.compatibility.projectFormat !== 3 || !module.compatibility.targets.includes(board?.target || 'esp32s3')) return 'Модуль несовместим с этим редактором монтажа.';
  return null;
}

export function pinProblem(project, pin, board) {
  if (!pin) return 'Контакт отсутствует в выбранной плате.';
  if (pin.kind !== 'gpio') return pin.kind === 'ground' ? null : 'Питание и управляющие контакты нельзя использовать как GPIO.';
  if (pin.reservedReason) return pin.reservedReason;
  if (board.reservedGpios?.[pin.gpio]) return board.reservedGpios[pin.gpio];
  if (pin.sharedWith && project.boardSettings?.[pin.sharedWith] !== 'disconnected') return 'Контакт разделяется с камерой. Сначала проверьте и укажите, что камера отключена.';
  return null;
}

export function connectionProblem(project, catalog, componentId, terminalId, pinId) {
  const board = boardFor(project, catalog);
  if (!board?.pins.length) return 'Сначала выберите конкретную плату с документированными контактами.';
  const component = lookup(project.components, componentId);
  if (!component) return 'Компонент не найден.';
  const problem = moduleProblem(component, catalog, board);
  if (problem) return problem;
  const module = moduleFor(component, catalog);
  const terminal = lookup(module.terminals, terminalId);
  const pin = lookup(board.pins, pinId);
  if (!terminal) return 'Контакт компонента не найден.';
  if (!pin) return 'Контакт платы не найден.';
  if (terminal.kind === 'power') return pin.kind === 'power' && pin.voltage === terminal.voltage ? null : 'Питание компонента подключается к контакту платы с указанным напряжением.';
  if (terminal.kind === 'ground') return pin.kind === 'ground' ? null : 'Общий контакт / катод должен быть подключён к GND. Питание и GPIO здесь недопустимы.';
  if (pin.kind !== 'gpio') return 'Сигнальный контакт подключается к GPIO, а не к питанию, GND или управлению.';
  const restriction = pinProblem(project, pin, board);
  if (restriction) return restriction;
  const capability = terminal.kind === 'gpio-output' ? 'digital-output' : terminal.kind === 'gpio-input' ? 'digital-input' : null;
  if (!capability || !pin.capabilities.includes(capability)) return 'GPIO не поддерживает требуемое направление цифрового интерфейса.';
  const conflict = project.assembly.connections.find(wire => {
    if (wire.componentId === componentId && wire.terminalId === terminalId) return false;
    return lookup(board.pins, wire.boardPinId)?.gpio === pin.gpio;
  });
  if (conflict) return `GPIO${pin.gpio} уже назначен другому контакту. Сначала удалите прежнее соединение.`;
  return null;
}

export function gpioAssignments(project, catalog) {
  const board = boardFor(project, catalog);
  return project.assembly.connections.flatMap(wire => {
    const pin = board?.pins.find(pin => pin.id === wire.boardPinId);
    const component = project.components.find(component => component.id === wire.componentId);
    const terminal = component && moduleFor(component, catalog)?.terminals.find(terminal => terminal.id === wire.terminalId);
    return pin?.kind === 'gpio' && terminal && terminal.kind !== 'ground' ? [{ componentId: wire.componentId, terminalId: wire.terminalId, pinId: pin.id, gpio: pin.gpio, mode: terminal.kind === 'gpio-output' ? 'output' : 'input' }] : [];
  });
}

function withConnections(project, connections, catalog) {
  const updated = { ...project, assembly: { ...project.assembly, connections } };
  return { ...updated, gpioAssignments: gpioAssignments(updated, catalog) };
}

export function connectTerminal(project, catalog, componentId, terminalId, boardPinId) {
  const problem = connectionProblem(project, catalog, componentId, terminalId, boardPinId);
  if (problem) throw new Error(problem);
  const previous = project.assembly.connections.find(w => w.componentId === componentId && w.terminalId === terminalId);
  if (previous?.boardPinId === boardPinId) return project;
  const connections = project.assembly.connections.filter(w => !(w.componentId === componentId && w.terminalId === terminalId));
  return withConnections(project, [...connections, { id: previous?.id || crypto.randomUUID(), componentId, terminalId, boardPinId }], catalog);
}

export function disconnectTerminal(project, catalog, componentId, terminalId) {
  return withConnections(project, project.assembly.connections.filter(w => !(w.componentId === componentId && w.terminalId === terminalId)), catalog);
}

export function removeWire(project, catalog, id) {
  return withConnections(project, project.assembly.connections.filter(wire => wire.id !== id), catalog);
}

export function addHardware(project, module, catalog = null) {
  if (project.components.length >= 100) throw new Error('В одном проекте поддерживается до 100 компонентов.');
  if (project.moduleVersions[module.id] && project.moduleVersions[module.id] !== module.version) throw new Error('Проект использует другую версию этого модуля.');
  const id = crypto.randomUUID();
  let number = 1;
  while (project.components.some(component => component.name === `${module.name} ${number}`)) number++;
  const name = `${module.name} ${number}`;
  const occupied = project.components.map(component => {
    const visual = catalog?.modules.find(item => item.id === component.moduleId)?.visual;
    return { ...project.assembly.positions[component.id], width: visual?.width || 230, height: visual?.height || 185 };
  });
  const width = module.visual?.width || 230, height = module.visual?.height || 185;
  let slot = 0, position;
  do {
    position = { x: 670 + (Math.floor(slot / 3) % 12) * 270, y: 100 + (Math.floor(slot / 36) * 3 + slot % 3) * 215 };
    slot++;
  } while (occupied.some(value => position.x < value.x + value.width + 20 && position.x + width + 20 > value.x && position.y < value.y + value.height + 20 && position.y + height + 20 > value.y));
  return {
    ...project,
    components: [...project.components, { id, moduleId: module.id, moduleVersion: module.version, name, parameters: Object.fromEntries(Object.entries(module.parameters).map(([key, parameter]) => [key, parameter.default])) }],
    moduleVersions: { ...project.moduleVersions, [module.id]: module.version },
    assembly: { ...project.assembly, positions: { ...project.assembly.positions, [id]: position } },
  };
}

export function removeHardware(project, catalog, id) {
  const components = project.components.filter(component => component.id !== id);
  const positions = Object.fromEntries(Object.entries(project.assembly.positions).filter(([key]) => key !== id));
  const moduleVersions = Object.fromEntries(Object.entries(project.moduleVersions).filter(([key]) => [...components, ...project.logic.nodes].some(component => component.moduleId === key)));
  return withConnections({ ...project, components, moduleVersions, ...(project.screens ? { screens: Object.fromEntries(Object.entries(project.screens).filter(([key]) => key !== id)) } : {}), assembly: { ...project.assembly, positions, ...(project.assembly.portSides ? { portSides: Object.fromEntries(Object.entries(project.assembly.portSides).filter(([key]) => key !== id)) } : {}) } }, project.assembly.connections.filter(wire => wire.componentId !== id), catalog);
}

export function selectBoard(project, board) {
  return { ...project, boardId: board.id, boardSettings: Object.fromEntries(Object.entries(board.options || {}).map(([key, option]) => [key, option.default])), gpioAssignments: [], assembly: { ...project.assembly, positions: { ...project.assembly.positions, board: { ...DEFAULT_BOARD_POSITION } }, connections: [], viewport: { ...DEFAULT_VIEWPORT } } };
}

export function validateAssembly(project, catalog) {
  const issues = [];
  const issue = (severity, code, message, fields = {}) => issues.push({ severity, code, message, ...fields });
  const board = boardFor(project, catalog);
  if (!board) { issue('error', 'board-missing', 'Плата отсутствует в каталоге.'); return issues; }
  if (!board.pins.length) issue('error', 'board-generic', 'Выберите конкретную плату. Общая ESP32-S3 не имеет распиновки.');
  else if (!board.pinoutVerified) issue('warning', 'revision-unconfirmed', 'Ревизия ESP32-S3-ETH не подтверждена. Сверьте физическую плату с документацией профиля.');
  for (const [key, option] of Object.entries(board.options || {})) {
    const value = project.boardSettings?.[key] || option.default;
    if (!option.values.some(item => item.value === value)) issue('error', 'board-option', `Неизвестное значение настройки «${option.label}».`);
    else if (value === 'unknown') issue('warning', 'shared-pins', 'Наличие камеры не проверено. Её общие контакты заблокированы.');
  }
  for (const component of project.components) {
    const fields = { componentId: component.id };
    const problem = moduleProblem(component, catalog, board);
    if (problem) { issue('error', 'module-compatibility', `${component.name}: ${problem}`, fields); continue; }
    const module = moduleFor(component, catalog);
    if (project.moduleVersions[module.id] !== component.moduleVersion) issue('error', 'module-version', `${component.name}: версии экземпляра и библиотеки проекта не совпадают.`, fields);
    for (const [key, parameter] of Object.entries(module.parameters)) {
      const value = component.parameters[key];
      if (parameter.type === 'number' && (!Number.isFinite(value) || value < parameter.min || value > parameter.max)) issue('error', 'parameter-range', `${component.name}: «${parameter.label}» должен быть в диапазоне ${parameter.min}-${parameter.max}.`, fields);
      if (parameter.type === 'select' && !parameter.options.some(option => option.value === value)) issue('error', 'parameter-option', `${component.name}: неверный параметр «${parameter.label}».`, fields);
    }
    if (module.constraints.requiresSeriesResistor) {
      const { resistorOhms, forwardVoltage } = component.parameters;
      const currentMa = (module.constraints.signalVoltage - forwardVoltage) / resistorOhms * 1000;
      if (Number.isFinite(currentMa) && currentMa > module.constraints.maxCurrentMa) issue('error', 'led-current', `${component.name}: расчётный ток ${currentMa.toFixed(1)} мА превышает предел модуля ${module.constraints.maxCurrentMa} мА. Увеличьте резистор.`, fields);
    }
    for (const terminal of module.terminals) {
      if (!project.assembly.connections.some(wire => wire.componentId === component.id && wire.terminalId === terminal.id)) issue('error', 'terminal-unconnected', `${component.name}: подключите «${terminal.label}».`, fields);
    }
  }
  for (const wire of project.assembly.connections) {
    const problem = connectionProblem(project, catalog, wire.componentId, wire.terminalId, wire.boardPinId);
    if (problem) issue('error', 'connection-invalid', problem, { componentId: wire.componentId, wireId: wire.id, pinId: wire.boardPinId });
  }
  if (JSON.stringify(project.gpioAssignments) !== JSON.stringify(gpioAssignments(project, catalog))) issue('error', 'gpio-cache', 'Назначения GPIO не совпадают с физическими соединениями. Переназначьте контакты в редакторе.');
  if (!project.components.length && board.pins.length) issue('warning', 'empty-assembly', 'Добавьте внешний светодиод или кнопку из библиотеки.');
  return issues;
}
