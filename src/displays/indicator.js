const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
export function indicatorState(element, value = element.initialValue) {
  if (element.mode !== 'dynamic') return element.states.find(state => state.id === element.staticStateId) || element.states[0];
  return element.states.find(state => state.value === value) || element.states.find(state => state.id === element.fallbackStateId) || element.states[0];
}
export function indicatorCaption(element) { return element.captionDynamic ? element.initialCaption : indicatorState(element)?.text || ''; }
export function indicatorLayout(element) {
  const vertical = ['top', 'bottom'].includes(element.dotPosition), reserve = element.dotVisible ? element.dotSize + element.gap : 0;
  return { direction: { left: 'row', right: 'row-reverse', top: 'column', bottom: 'column-reverse' }[element.dotPosition], labelWidth: element.width - 2 * element.padding - (vertical ? 0 : reserve), labelHeight: element.height - 2 * element.padding - (vertical ? reserve : 0) };
}
export function indicatorIssues(element) {
  const issues = [];
  if(!['number','boolean','text'].includes(element.valueType))issues.push('Выберите тип значения состояния.');
  if (!integer(element.width, 16, 4096) || !integer(element.height, 16, 4096) || !integer(element.radius, 0, Math.floor(Math.min(element.width, element.height) / 2)) || !integer(element.padding, 0, 64) || !integer(element.gap, 0, 64) || !integer(element.dotSize, 2, 64) || typeof element.dotVisible !== 'boolean' || !['left','right','top','bottom'].includes(element.dotPosition) || !['left','center','right'].includes(element.align)) issues.push('Проверьте размеры, скругление, отступы и расположение точки.');
  if (typeof element.captionDynamic !== 'boolean' || typeof element.initialCaption !== 'string' || element.initialCaption.length > 500) issues.push('Проверьте динамическую надпись индикатора.');
  if (!Array.isArray(element.states) || !element.states.length || element.states.length > 32) return [...issues, 'Индикатор должен содержать от 1 до 32 состояний.'];
  const ids = new Set(), values = new Set();
  for (const state of element.states) {
    if (!state || typeof state !== 'object') { issues.push('Некорректное состояние индикатора.'); continue; }
    const validValue = element.valueType === 'number' ? Number.isFinite(state.value) : element.valueType === 'boolean' ? typeof state.value === 'boolean' : typeof state.value === 'string' && state.value.length <= 200;
    if (!state || typeof state.id !== 'string' || !state.id || ids.has(state.id) || values.has(JSON.stringify(state.value)) || typeof state.name !== 'string' || !state.name.trim() || state.name.length > 80 || typeof state.text !== 'string' || state.text.length > 500 || !validValue || ![state.background, state.color, state.dotColor].every(color)) issues.push('Проверьте названия, значения и оформление состояний; значения должны отличаться.');
    ids.add(state.id); values.add(JSON.stringify(state.value));
  }
  if (!ids.has(element.staticStateId) || !ids.has(element.fallbackStateId)) issues.push('Выберите статическое и резервное состояния индикатора.');
  const layout = indicatorLayout(element);
  if (layout.labelWidth < 1 || layout.labelHeight < 1) issues.push('Отступы и точка занимают всю доступную область индикатора.');
  return issues;
}
export function newIndicator(display) {
  const make = (value, background, dotColor) => ({id:crypto.randomUUID(), name:`Состояние ${value + 1}`, value, text:`Состояние ${value + 1}`, background, color:'#ffffff', dotColor});
  const states = [make(0,'#1b2d42','#a78bfa'),make(1,'#20363f','#38bdf8')];
  return { id:crypto.randomUUID(), name:'Индикатор', type:'indicator', text:'', color:'#ffffff', fontId:display.graphics.fonts[0].id, x:20, y:20, width:Math.min(180,display.resolution.width-20), height:42, radius:12, padding:8, gap:8, dotVisible:true, dotSize:8, dotPosition:'left', align:'left', mode:'static', valueType:'number', initialValue:0, prefix:'', suffix:'', captionDynamic:false, initialCaption:states[0].text, states, staticStateId:states[0].id, fallbackStateId:states[0].id };
}
