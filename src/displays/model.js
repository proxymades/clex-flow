import { indicatorIssues, indicatorCaption } from './indicator.js';
export const VALUE_TYPES = ['number', 'boolean', 'text'];
export const isDynamicText = element => element.mode === 'dynamic' || element.type === 'indicator' && element.captionDynamic;
export const elementName = (element, index) => element.name?.trim() || `${element.type === 'indicator' ? 'Индикатор' : 'Текст'} ${index + 1}`;
export function elementPreviewText(element) {
  if (element.type === 'indicator') return indicatorCaption(element);
  if (!isDynamicText(element)) return element.text;
  const value = element.valueType === 'boolean' ? (element.initialValue ? 'Да' : 'Нет') : String(element.initialValue ?? '');
  return (element.prefix || '') + value + (element.suffix || '');
}
export const elementUpdatePort = id => 'update.' + id;
export function elementBindings(element, index = 0) {
  const bindings = [];
  if (element.mode === 'dynamic') bindings.push({id:element.id, name:elementName(element,index), type:element.valueType, channel:element.type === 'indicator' ? 'state' : 'value', element});
  if (element.type === 'indicator' && element.captionDynamic) bindings.push({id:'caption.' + element.id, name:'Надпись: ' + elementName(element,index), type:'text', channel:'caption', element});
  return bindings;
}
export function screenBindings(screen) { return screen.elements.flatMap(elementBindings); }
export function screenPorts(screen) {
  const bindings = screenBindings(screen);
  if (!bindings.length) return [];
  return [{id:'trigger',name:'Обновить',type:'event',required:false}, ...bindings.flatMap(binding => [{id:binding.id,name:binding.name,type:binding.type,required:true},{id:elementUpdatePort(binding.id),name:'Обновить: ' + binding.name,type:'event',required:false}])];
}
export function dynamicTextValid(element) {
  return VALUE_TYPES.includes(element.valueType)
    && typeof element.prefix === 'string' && element.prefix.length <= 200
    && typeof element.suffix === 'string' && element.suffix.length <= 200
    && (element.valueType === 'number' ? Number.isFinite(element.initialValue) : element.valueType === 'boolean' ? typeof element.initialValue === 'boolean' : typeof element.initialValue === 'string' && element.initialValue.length <= 500)
    && element.id !== 'trigger';
}
export const colorValid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function displayDescription(component, catalog) {
  return catalog.modules.find(module => module.id === component?.moduleId)?.display || null;
}
export function emptyScreen() { return { formatVersion: 1, background: '#000000', elements: [] }; }
export function screenFor(project, componentId) { return project.screens?.[componentId] || emptyScreen(); }
export function screenIssues(screen, display) {
  const issues = [];
  if (!display) return ['Описание дисплея отсутствует.'];
  if (screen.formatVersion !== 1 || !colorValid(screen.background) || !Array.isArray(screen.elements) || screen.elements.length > display.graphics.maxElements) return ['Некорректный интерфейс экрана.'];
  const ids = new Set();
  for (const element of screen.elements) {
    const font = display.graphics.fonts.find(font => font.id === element.fontId);
    if (!['text','indicator'].includes(element.type) || typeof element.id !== 'string' || !element.id || ids.has(element.id)) issues.push('Некорректный или повторяющийся элемент экрана.');
    ids.add(element.id);
    if (!Number.isInteger(element.x) || !Number.isInteger(element.y) || element.x < 0 || element.y < 0 || element.x >= display.resolution.width || element.y >= display.resolution.height) issues.push('Координаты текста находятся вне экрана.');
    if (element.mode !== undefined && !['static', 'dynamic'].includes(element.mode)) issues.push('Неизвестный режим текстового элемента.');
    if (element.name !== undefined && (typeof element.name !== 'string' || element.name.length > 80)) issues.push('Название элемента не должно превышать 80 символов.');
    if (element.mode === 'dynamic' && !dynamicTextValid(element)) issues.push('Проверьте тип, начальное значение, префикс и суффикс динамического текста.');
    if (element.type === 'indicator') {
      issues.push(...indicatorIssues(element));
      if (element.x + element.width > display.resolution.width || element.y + element.height > display.resolution.height) issues.push('Индикатор выходит за границы экрана.');
      if (font && Array.isArray(element.states) && element.states.some(state => typeof state?.text === 'string' && [...state.text].some(char => !font.ranges.some(([min,max]) => char.codePointAt(0) >= min && char.codePointAt(0) <= max)))) issues.push('Шрифт не содержит некоторые символы состояния.');
    }
    if (!font || !colorValid(element.color) || typeof element.text !== 'string' || element.text.length > 500) issues.push('Проверьте текст, цвет и доступный шрифт.');
    else if ([...elementPreviewText(element)].some(char => !font.ranges.some(([min,max]) => char.codePointAt(0) >= min && char.codePointAt(0) <= max))) issues.push('Выбранный шрифт не содержит некоторые символы текста.');
  }
  const ports = screenPorts(screen);
  if (new Set(ports.map(port => port.id)).size !== ports.length) issues.push('Идентификаторы элементов конфликтуют с портами обновления.');
  return issues;
}
export function saveScreen(project, componentId, screen) {
  const before = new Map(screenPorts(screenFor(project, componentId)).map(port => [port.id, port.type]));
  const after = new Map(screenPorts(screen).map(port => [port.id, port.type]));
  const nodes = new Set(project.logic.nodes.filter(node => node.parameters.componentId === componentId).map(node => node.id));
  const edges = project.logic.edges.filter(edge => !nodes.has(edge.target) || !before.has(edge.targetHandle) || before.get(edge.targetHandle) === after.get(edge.targetHandle));
  const saved=structuredClone(screen);for(const element of saved.elements)delete element.editStateId;
  return { ...project, screens: { ...project.screens, [componentId]: saved }, logic: { ...project.logic, edges } };
}
