export const TEXT_TO_NUMBER='clex.logic.text-to-number';
export const COMPARE_NUMBER='clex.logic.compare-number';
export const NUMERIC_MODULES=new Set([TEXT_TO_NUMBER,COMPARE_NUMBER]);

export function numericLogicIssues(node,project) {
 const p=node.parameters;
 if(node.moduleId===TEXT_TO_NUMBER && p.format==='affixes') {
  return ['prefix','suffix'].flatMap(key=>typeof p[key]==='string' && (p[key].includes('\0')||new TextEncoder().encode(p[key]).length>64)?['Подпись числа должна содержать до 64 байт UTF-8 без нулевого символа.']:[]);
 }
 if(node.moduleId!==COMPARE_NUMBER || p.mode!=='range')return [];
 const dynamic=port=>project.logic.edges.some(edge=>edge.target===node.id&&edge.targetHandle===port);
 if(dynamic('lower')||dynamic('upper'))return [];
 if(p.lower>p.upper)return ['Нижняя граница должна быть не больше верхней.'];
 if(p.lower===p.upper&&(!p.includeLower||!p.includeUpper))return ['Пустой диапазон: для одинаковых границ включите обе границы.'];
 return [];
}

export function numericSummary(node,project) {
 const p=node.parameters;
 const display=key=>project?.logic.edges.some(edge=>edge.target===node.id&&edge.targetHandle===key)?'вход':Number.isFinite(p[key])?new Intl.NumberFormat('ru-RU',{maximumSignificantDigits:12}).format(p[key]):'не задано';
 if(node.moduleId===TEXT_TO_NUMBER)return p.format==='affixes'?[p.prefix,'число',p.suffix].filter(Boolean).join(' '):'Текст → число';
 if(node.moduleId!==COMPARE_NUMBER)return null;
 if(p.mode==='range')return display('lower')+' '+(p.includeLower?'≤':'<')+' число '+(p.includeUpper?'≤':'<')+' '+display('upper');
 return 'Число '+({lt:'<',lte:'≤',eq:'=',neq:'≠',gte:'≥',gt:'>'}[p.operator]||'?')+' '+display('reference')+(['eq','neq'].includes(p.operator)&&p.tolerance>0?' · допуск '+p.tolerance:'');
}
