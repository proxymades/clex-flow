export const RESISTOR_MODULE = 'clex.hardware.resistor';
export const isResistor = component => component?.moduleId === RESISTOR_MODULE;
const contact = (componentId, terminalId) => 'component:' + componentId + ':' + terminalId;
const boardContact = id => 'board:' + id;

// Wires join contacts. A resistor separates two nets; it never shorts them together.
export function electricalModel(project, catalog) {
  const board = catalog.boards.find(item => item.id === project.boardId);
  const parent = new Map();
  const root = key => {
    if (!parent.has(key)) parent.set(key, key);
    if (parent.get(key) !== key) parent.set(key, root(parent.get(key)));
    return parent.get(key);
  };
  for (const wire of project.assembly.connections) {
    const target = contact(wire.componentId, wire.terminalId);
    const source = wire.sourceComponentId ? contact(wire.sourceComponentId, wire.sourceTerminalId) : boardContact(wire.boardPinId);
    parent.set(root(target), root(source));
  }
  const same = (a, b) => root(a) === root(b);
  const pinsAt = key => (board?.pins || []).filter(pin => same(key, boardContact(pin.id)));
  const pins = (id, terminal) => pinsAt(contact(id, terminal));
  const resistors = project.components.filter(isResistor);
  const attached = (id, terminal) => resistors.flatMap(resistor => ['a', 'b'].flatMap(end => {
    const own = contact(id, terminal), near = contact(resistor.id, end), far = contact(resistor.id, end === 'a' ? 'b' : 'a');
    return same(own, near) ? [{ resistor, end, pins: pinsAt(far), bypassed: same(near, far) }] : [];
  }));
  const signalPin = (component, terminal) => {
    const direct = pins(component.id, terminal).filter(pin => pin.kind === 'gpio');
    if (direct.length === 1) return direct[0];
    if (direct.length || component.moduleId !== 'clex.hardware.led') return null;
    const series = attached(component.id, terminal).filter(path => !path.bypassed).flatMap(path => path.pins.filter(pin => pin.kind === 'gpio'));
    return series.length === 1 ? series[0] : null;
  };
  return { board, pins, attached, signalPin, same: (a, at, b, bt) => same(contact(a, at), contact(b, bt)) };
}

export function electricalIssues(project, catalog, model = electricalModel(project, catalog)) {
  const issues = [], seen = new Set();
  const add = (code, message, componentId) => issues.push({ severity: 'error', code, message, componentId });
  for (const component of project.components) {
    const definition = catalog.modules.find(module => module.id === component.moduleId);
    for (const terminal of definition?.terminals || []) {
      if(['gpio-input','gpio-output'].includes(terminal.kind)&&model.attached(component.id,terminal.id).length&&!model.signalPin(component,terminal.id))add('electrical-signal-missing',component.name+': сигнальная цепь через резистор не подключена к одному GPIO.',component.id);
      const pins = model.pins(component.id, terminal.id);
      const signature = pins.map(pin => pin.id).sort().join('/');
      if (!signature || seen.has(signature)) continue;
      seen.add(signature);
      const gpios = new Set(pins.filter(pin => pin.kind === 'gpio').map(pin => pin.gpio));
      const rails = new Set(pins.filter(pin => pin.kind === 'ground' || pin.kind === 'power').map(pin => pin.kind === 'ground' ? 0 : pin.voltage));
      if (gpios.size > 1) add('electrical-gpio-short', 'Одна цепь напрямую соединяет несколько GPIO. Разделите сигналы.', component.id);
      if (rails.size > 1 || gpios.size && rails.size) add('electrical-short', 'Сигнал или разные цепи питания соединены напрямую. Проверьте подключение резистора.', component.id);
    }
    if (isResistor(component) && model.same(component.id, 'a', component.id, 'b')) {
      add('resistor-bypassed', component.name + ': оба вывода соединены одной цепью; резистор обойдён проводом.', component.id);
    }
  }
  return issues;
}

export function ledResistance(component, project, catalog) {
  const model = electricalModel(project, catalog);
  if(model.pins(component.id,'anode').some(pin=>pin.kind==='gpio'))return component.parameters.resistorOhms;
  const physical = model.attached(component.id, 'anode').filter(path => !path.bypassed && path.pins.some(pin => pin.kind === 'gpio'));
  return physical.length === 1 ? physical[0].resistor.parameters.resistanceOhms : component.parameters.resistorOhms;
}
