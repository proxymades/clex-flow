import {parseContact,wireSource,touches,normalizedContact,componentWireProblem} from './endpoints.js';
import {stepperIssues} from '../stepper/model.js';
import {ROUTER_MODULE,routerCapabilities,routerIssues} from '../router/model.js';
import {ESPNOW_MODULE,espNowSupported,espNowIssues,newKey} from '../espnow/model.js';
import { moduleSupportsBoard } from '../catalog/compatibility.js';
import { terminalLayout } from './terminalLayout.js';
import { reanchorManualRoute } from './wireRouting.js';
import { hardwareProvider, resourceIssues, claimedGpio, sharedPinProblem } from '../hardware/resources.js';
import { networkProvider, networkIssues, spiOptions, spiUsage } from '../network/model.js';
export const DEFAULT_BOARD_POSITION = { x: 100, y: 40 };
export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
const lookup = (items, id) => items.find(item => item.id === id);
export const boardFor = (project, catalog) => lookup(catalog.boards, project.boardId);
export const moduleFor = (component, catalog) => lookup(catalog.modules, component.moduleId);

export function transformAssembly(project,catalog,transform){
 const previous=project.assembly.positions,positions={...previous,...transform.positions},board=boardFor(project,catalog);
 const connections=project.assembly.connections.map(wire=>{
  if(!wire.route?.length)return wire;
  const sourceId=wire.sourceComponentId||'board';
  const oldSource=previous[sourceId],newSource=positions[sourceId],oldTarget=previous[wire.componentId],newTarget=positions[wire.componentId];
  if(!oldSource || !newSource || !oldTarget || !newTarget || oldSource.x===newSource.x && oldSource.y===newSource.y && oldTarget.x===newTarget.x && oldTarget.y===newTarget.y)return wire;
  const source=wire.sourceComponentId&&project.components.find(c=>c.id===wire.sourceComponentId);
  const pin=source?terminalLayout(moduleFor(source,catalog),project.assembly.portSides?.[source.id]).terminals.find(t=>t.id===wire.sourceTerminalId):board?.pins.find(pin=>pin.id===wire.boardPinId),component=project.components.find(component=>component.id===wire.componentId);
  const terminal=component && terminalLayout(moduleFor(component,catalog),project.assembly.portSides?.[component.id]).terminals.find(terminal=>terminal.id===wire.terminalId);
  if(!pin || !terminal)return wire;
  const anchor=(position,contact)=>[position.x+contact.x,position.y+contact.y];
  const points=reanchorManualRoute(anchor(oldSource,pin),anchor(oldTarget,terminal),wire.route,anchor(newSource,pin),anchor(newTarget,terminal));
  const updated={...wire},route=points.slice(1,-1).map(([x,y])=>({x,y}));
  updated.route=route.length?route:[{x:(points[0][0]+points.at(-1)[0])/2,y:(points[0][1]+points.at(-1)[1])/2}];
  return updated;
 });
 return {...project,assembly:{...project.assembly,positions,connections,viewport:transform.viewport || project.assembly.viewport}};
}

export function moduleProblem(component, catalog, board = null) {
  const module = moduleFor(component, catalog);
  if (!module) return 'Модуль не установлен в библиотеке.';
  if(module.softwareInterface==='espnow'&&board&&!espNowSupported(board))return 'Эта плата не имеет поддерживаемого ESP-NOW-радиоинтерфейса.';
  if (board && module.hardwareInterface && !hardwareProvider(component,module,board)) return 'Выберите совместимый аппаратный интерфейс платы.';
  if (module.version !== component.moduleVersion) return `Требуется модуль ${component.moduleId} версии ${component.moduleVersion}; установлен ${module.version}.`;
  if (board && !moduleSupportsBoard(module,board)) return 'Для выбранной платформы нет реализованного драйвера этого компонента.';
  if (module.network && board && !board.networkInterfaces?.some(provider=>provider.family===module.network.family)) return 'Для выбранной платы нет описанного сетевого интерфейса этого типа.';
  if (module.kind !== 'hardware' || module.compatibility.projectFormat !== 3 || !module.compatibility.targets.includes(board?.target || 'esp32s3')) return 'Модуль несовместим с этим редактором монтажа.';
  return null;
}

export function pinProblem(project, pin, board) {
  if (!pin) return 'Контакт отсутствует в выбранной плате.';
  if (pin.kind !== 'gpio') return pin.kind === 'ground' ? null : 'Питание и управляющие контакты нельзя использовать как GPIO.';
  if (pin.reservedReason) return pin.reservedReason;
  if (board.reservedGpios?.[pin.gpio]) return board.reservedGpios[pin.gpio];
  const shared = sharedPinProblem(project,pin,board);
  if (shared) return shared;
  return null;
}

export function connectionProblem(project, catalog, componentId, terminalId, pinId) {
  const normalized=normalizedContact(project,catalog,componentId,terminalId,pinId);componentId=normalized.componentId;terminalId=normalized.terminalId;pinId=normalized.value;
  if(parseContact(pinId))return componentWireProblem(project,catalog,componentId,terminalId,pinId);
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
  if (terminal.kind === 'power') return pin.kind === 'power' && pin.voltage === (terminal.voltageParameter ? Number(component.parameters[terminal.voltageParameter]) : terminal.voltage) ? null : 'Питание компонента подключается к контакту платы с указанным напряжением.';
  if (terminal.kind === 'ground') return pin.kind === 'ground' ? null : 'Общий контакт / катод должен быть подключен к GND. Питание и GPIO здесь недопустимы.';
  if (pin.kind !== 'gpio') return 'Сигнальный контакт подключается к GPIO, а не к питанию, GND или управлению.';
  if (module.constraints.signalVoltageParameter && Number(component.parameters[module.constraints.signalVoltageParameter]) > (board.logicVoltage || 3.3)) return `Уровень OUT превышает допустимые ${board.logicVoltage || 3.3} В GPIO платы. Используйте совместимый уровень сигнала.`;
  const claim = claimedGpio(project,catalog,pin.gpio);
  if (claim) return `GPIO${pin.gpio} используется компонентом «${claim.name}» (${claim.label || claim.key}).`;
  const restriction = pinProblem(project, pin, board);
  if (restriction) return restriction;
  const capability = terminal.kind === 'gpio-output' ? 'digital-output' : terminal.kind === 'gpio-input' ? 'digital-input' : null;
  if (!capability || !pin.capabilities.includes(capability)) return 'GPIO не поддерживает требуемое направление цифрового интерфейса.';
  if (capability==='digital-input' && pin.internalPulls===false && ['up','down'].includes(component.parameters.pull)) return 'У этого GPIO нет внутренней подтяжки. Выберите другой вход для компонента с внутренней подтяжкой.';
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
  const normalized=normalizedContact(project,catalog,componentId,terminalId,boardPinId);componentId=normalized.componentId;terminalId=normalized.terminalId;boardPinId=normalized.value;
  const problem = connectionProblem(project, catalog, componentId, terminalId, boardPinId);
  if (problem) throw new Error(problem);
  const previous = project.assembly.connections.find(w => w.componentId === componentId && w.terminalId === terminalId);
  if (previous&&wireSource(previous) === boardPinId) return project;
  const connections = project.assembly.connections.filter(w => !(w.componentId === componentId && w.terminalId === terminalId));
  const source=parseContact(boardPinId);
  return withConnections(project, [...connections, { id: previous?.id || crypto.randomUUID(), componentId, terminalId, ...(source?{sourceComponentId:source.componentId,sourceTerminalId:source.terminalId}:{boardPinId}) }], catalog);
}

export function disconnectTerminal(project, catalog, componentId, terminalId) {
  return withConnections(project, project.assembly.connections.filter(w => !touches(w,componentId,terminalId)), catalog);
}

export function removeWire(project, catalog, id) {
  return withConnections(project, project.assembly.connections.filter(wire => wire.id !== id), catalog);
}

export function addHardware(project, module, catalog = null) {
  if (project.components.length >= 100) throw new Error('В одном проекте поддерживается до 100 компонентов.');
  if (project.moduleVersions[module.id] && project.moduleVersions[module.id] !== module.version) throw new Error('Проект использует другую версию этого модуля.');
  const id = crypto.randomUUID();
  let number = 1;
  const instanceName = number => module.display ? `${module.name} · №${number}` : `${module.name} ${number}`;
  while (project.components.some(component => component.name === instanceName(number) || component.name === `${module.name} ${number}`)) number++;
  const name = instanceName(number);
  const parameters=Object.fromEntries(Object.entries(module.parameters).map(([key,parameter])=>[key,parameter.default]));
  if(module.id===ROUTER_MODULE){if(!catalog||!routerCapabilities(boardFor(project,catalog)).available)throw new Error('У платы нет совместимого Wi-Fi STA/SoftAP-интерфейса.');if(project.components.some(c=>c.moduleId===ROUTER_MODULE))throw new Error('Маршрутизатор уже добавлен.');parameters.otaEnabled=boardFor(project,catalog).firmware.flashSizeMb>=8;parameters.adminPassword=newKey().slice(0,24);parameters.apPassword=newKey().slice(0,16);parameters.ethernetId=project.components.find(c=>c.moduleId==='clex.hardware.ethernet')?.id||'';}
  if(module.softwareInterface==='espnow'){if(!catalog||!espNowSupported(boardFor(project,catalog)))throw new Error('Для платы нет ESP-NOW-радиоинтерфейса.');if(project.components.some(c=>c.moduleId===ESPNOW_MODULE))throw new Error('ESP-NOW уже добавлен: плата использует одно радио.');parameters.pmk=newKey();}
  if(module.hardwareInterface&&catalog){const provider=boardFor(project,catalog)?.peripherals?.find(provider=>provider.family===module.hardwareInterface.family && provider.interface===module.hardwareInterface.interface);parameters.interfaceId=provider?.id || '';}
  if(module.network&&catalog){const board=boardFor(project,catalog),provider=board.networkInterfaces?.find(provider=>provider.family===module.network.family);if(!provider)throw new Error('На этой плате нет описанного сетевого интерфейса.');if(project.components.some(component=>networkProvider(component,board,module)?.id===provider.id))throw new Error('Этот встроенный интерфейс уже добавлен.');parameters.providerId=provider.id;}
  if(module.parameters.spiHost&&catalog&&(!module.network||networkProvider({parameters},boardFor(project,catalog),module)?.interface==='spi')){const options=spiOptions(project,catalog,id).filter(option=>!option.busy.length);parameters.spiHost=options.find(option=>option.value===String(parameters.spiHost))?.value||options[0]?.value||'';}

  if(catalog)Object.assign(parameters,boardFor(project,catalog)?.componentDefaults?.[module.id]);
  const occupied = project.components.map(component => {
    const layout = terminalLayout(catalog?.modules.find(item => item.id === component.moduleId), project.assembly.portSides?.[component.id]);
    return { ...project.assembly.positions[component.id], width: layout.width, height: layout.height };
  });
  const board = catalog && boardFor(project, catalog), boardPosition = project.assembly.positions.board;
  if (board) occupied.push({ ...boardPosition, width: board.width, height: board.height });
  const { width, height } = terminalLayout(module);
  const origin = board ? { x: boardPosition.x + board.width + 48, y: boardPosition.y + 80 } : { x: 670, y: 100 };
  const xs = new Set([origin.x]), ys = new Set([origin.y]);
  for (const rectangle of occupied) {
    xs.add(rectangle.x + rectangle.width + 24); xs.add(rectangle.x - width - 24);
    ys.add(rectangle.y); ys.add(rectangle.y + rectangle.height + 24); ys.add(rectangle.y - height - 24);
  }
  const candidates = [...xs].flatMap(x => [...ys].map(y => ({ x, y }))).filter(point => Math.abs(point.x) <= 5000 && Math.abs(point.y) <= 5000);
  const distance = point => (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b) || Number(a.y < origin.y) - Number(b.y < origin.y) || a.y - b.y || a.x - b.x);
  const free = point => !occupied.some(value => point.x < value.x + value.width + 20 && point.x + width + 20 > value.x && point.y < value.y + value.height + 20 && point.y + height + 20 > value.y);
  const position = candidates.find(point => point.y >= boardPosition.y && free(point)) || candidates.find(free);
  if (!position) throw new Error('Не удалось найти свободное место для компонента. Переместите плату или один из компонентов.');
  return {
    ...project,
    components: [...project.components, { id, moduleId: module.id, moduleVersion: module.version, name, parameters }],
    moduleVersions: { ...project.moduleVersions, [module.id]: module.version },
    assembly: { ...project.assembly, positions: { ...project.assembly.positions, [id]: position } },
  };
}

export function removeHardware(project, catalog, id) {
  const components = project.components.filter(component => component.id !== id);
  const positions = Object.fromEntries(Object.entries(project.assembly.positions).filter(([key]) => key !== id));
  const moduleVersions = Object.fromEntries(Object.entries(project.moduleVersions).filter(([key]) => [...components, ...project.logic.nodes].some(component => component.moduleId === key)));
  return withConnections({ ...project, components, moduleVersions, ...(project.screens ? { screens: Object.fromEntries(Object.entries(project.screens).filter(([key]) => key !== id)) } : {}), assembly: { ...project.assembly, positions, ...(project.assembly.portSides ? { portSides: Object.fromEntries(Object.entries(project.assembly.portSides).filter(([key]) => key !== id)) } : {}) } }, project.assembly.connections.filter(wire => !touches(wire,id)), catalog);
}

export function selectBoard(project, board) {
  return { ...project, boardId: board.id, boardSettings: Object.fromEntries(Object.entries(board.options || {}).map(([key, option]) => [key, option.default])), gpioAssignments: [], assembly: { ...project.assembly, positions: { ...project.assembly.positions, board: { ...DEFAULT_BOARD_POSITION } }, connections: [], viewport: { ...DEFAULT_VIEWPORT } } };
}

export function validateAssembly(project, catalog) {
  const issues = [];
  const issue = (severity, code, message, fields = {}) => issues.push({ severity, code, message, ...fields });
  const board = boardFor(project, catalog);
  issues.push(...resourceIssues(project,catalog),...stepperIssues(project));
  if(project.components.filter(c=>c.moduleId===ESPNOW_MODULE).length>1)issue('error','espnow-duplicate','В проекте поддерживается один ESP-NOW-интерфейс платы.');
  if (!board) { issue('error', 'board-missing', 'Плата отсутствует в каталоге.'); return issues; }
  if (!board.pins.length) issue('error', 'board-generic', 'Выберите конкретную плату. Общая ESP32-S3 не имеет распиновки.');
  else if (!board.pinoutVerified) issue('warning', 'revision-unconfirmed', `Ревизия ${board.name} не подтверждена. Сверьте физическую плату с документацией профиля.`);
  for (const [key, option] of Object.entries(board.options || {})) {
    const value = project.boardSettings?.[key] || option.default;
    if (!option.values.some(item => item.value === value)) issue('error', 'board-option', `Неизвестное значение настройки «${option.label}».`);
    else if (value === 'unknown' && board.pins.some(pin=>Array.isArray(pin.sharedWith)?pin.sharedWith.includes(key):pin.sharedWith===key)) issue('warning', 'shared-pins', `«${option.label}»: подключение не подтверждено. Общие контакты ограничены.`);
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
    if (module.constraints.signalVoltageParameter && Number(component.parameters[module.constraints.signalVoltageParameter]) > Number(component.parameters[module.constraints.supplyVoltageParameter])) issue('error','input-voltage',`${component.name}: напряжение OUT не может превышать выбранное питание VCC.`,fields);
    if(module.softwareInterface==='espnow')for(const message of espNowIssues(component,board))issue('error','espnow-config',component.name+': '+message,fields);
    if(module.softwareInterface==='router')for(const message of routerIssues(component,project,catalog))issue('error','router-config',component.name+': '+message,fields);
    if(module.network)for(const message of networkIssues(component,board,module))issue('error','network-config',component.name+': '+message,fields);
    if(module.parameters.spiHost&&(!module.network||networkProvider(component,board,module)?.interface==='spi')&&!board.interfaces?.spi?.hosts.includes(Number(component.parameters.spiHost)))issue('error','spi-host',component.name+': выберите доступный SPI.',fields);
    if (module.constraints.requiresSeriesResistor) {
      const { resistorOhms, forwardVoltage } = component.parameters;
      const currentMa = ((board.logicVoltage || module.constraints.signalVoltage) - forwardVoltage) / resistorOhms * 1000;
      if (Number.isFinite(currentMa) && currentMa > module.constraints.maxCurrentMa) issue('error', 'led-current', `${component.name}: расчетный ток ${currentMa.toFixed(1)} мА превышает предел модуля ${module.constraints.maxCurrentMa} мА. Увеличьте резистор.`, fields);
    }
    for (const terminal of module.terminals) {
      if (!terminal.optional&&!project.assembly.connections.some(wire => touches(wire,component.id,terminal.id))) issue('error', 'terminal-unconnected', `${component.name}: подключите «${terminal.label}».`, fields);
    }
  }
  for(const claim of spiUsage(project,catalog))if(spiUsage(project,catalog).some(other=>other.componentId!==claim.componentId&&other.host===claim.host))issue('error','spi-conflict',`SPI${claim.host} занят несколькими компонентами; выберите свободный SPI.`,{componentId:claim.componentId});
  for (const wire of project.assembly.connections) {
    const problem = connectionProblem(project, catalog, wire.componentId, wire.terminalId, wireSource(wire));
    if (problem) issue('error', 'connection-invalid', problem, { componentId: wire.componentId, wireId: wire.id, pinId: wire.boardPinId });
  }
  if (JSON.stringify(project.gpioAssignments) !== JSON.stringify(gpioAssignments(project, catalog))) issue('error', 'gpio-cache', 'Назначения GPIO не совпадают с физическими соединениями. Переназначьте контакты в редакторе.');
  if (!project.components.length && board.pins.length) issue('warning', 'empty-assembly', 'Добавьте компоненты во вкладке «Монтаж».');
  return issues;
}
