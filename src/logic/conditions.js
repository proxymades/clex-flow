export const CONDITION_MODULE = 'clex.logic.compare-number';
export const MAX_CONDITIONS = 8;
export const NUMBER_OPERATORS = [['lt','Меньше'],['lte','Меньше или равно'],['eq','Равно'],['neq','Не равно'],['gte','Больше или равно'],['gt','Больше']];
export const TEXT_OPERATORS = [['eq','Равно'],['neq','Не равно'],['contains','Содержит'],['starts','Начинается с'],['ends','Заканчивается на']];

export function newCondition(id = 'c1', type = 'boolean') {
  return {id, type, operator:type === 'number' ? 'gt' : 'eq', reference:type === 'boolean' ? true : type === 'number' ? 0 : '', tolerance:0, negate:false};
}

export function readConditionRows(node) {
  let rows;
  try { rows = JSON.parse(node.parameters.conditions); } catch { throw new Error('Не удалось прочитать условия.'); }
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_CONDITIONS) throw new Error('Добавьте от 1 до 8 условий.');
  const ids = new Set();
  for (const row of rows) {
    if (!row || !/^c[1-9][0-9]{0,5}$/.test(row.id) || ids.has(row.id) || !['number','text','boolean'].includes(row.type) || typeof row.negate !== 'boolean') throw new Error('Некорректная строка условия.');
    ids.add(row.id);
  }
  return rows;
}

export function readConditions(node) {
  const rows=readConditionRows(node);
  for(const row of rows){
    const operators = row.type === 'number' ? NUMBER_OPERATORS : row.type === 'text' ? TEXT_OPERATORS : [['eq'],['neq']];
    if (!operators.some(([key]) => key === row.operator)) throw new Error('Выберите допустимое сравнение.');
    if (row.type === 'number' && (!Number.isFinite(row.reference) || Math.abs(row.reference) > 1e12 || !Number.isFinite(row.tolerance) || row.tolerance < 0 || row.tolerance > 1e12) || row.type === 'boolean' && typeof row.reference !== 'boolean' || row.type === 'text' && (typeof row.reference !== 'string' || row.reference.includes('\0') || new TextEncoder().encode(row.reference).length > 256)) throw new Error('Проверьте значение для сравнения.');
  }
  return rows;
}

export function conditionPorts(node) {
  let rows;
  try { rows = readConditionRows(node); } catch { return []; }
  return rows.flatMap((row, index) => [
    {id:row.id + '.value', name:'Условие ' + (index + 1) + ': ' + ({number:'число',text:'текст',boolean:'Да/Нет'}[row.type]), type:row.type, required:true, sample:'latest', description:'Проверяется последнее значение источника по команде «Проверить».'},
    {id:row.id + '.reference', name:'Условие ' + (index + 1) + ': сравнить с', type:row.type, sample:'latest', description:'Подключённое значение заменяет значение из настройки условия.'},
  ]);
}

export function conditionIssues(node) {
  if (node.moduleId !== CONDITION_MODULE || node.parameters.mode !== 'conditions') return [];
  try { readConditions(node); } catch (error) { return [error.message]; }
  return ['all','any'].includes(node.parameters.combine) ? [] : ['Выберите объединение условий: И или ИЛИ.'];
}
