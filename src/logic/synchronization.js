export const SYNCHRONIZE_MODULE = 'clex.logic.synchronize';

export function synchronizationPorts(node) {
 const {eventCount} = node.parameters;
 if (!Number.isInteger(eventCount) || eventCount < 1 || eventCount > 16) return [];
 return Array.from({length:eventCount}, (_,i) => ({
  id:'event'+(i+1),name:'Событие '+(i+1),type:'event',required:true,
  description:'Запоминает поступление этого события во время ожидания. Повторный сигнал не засчитывается ещё раз.',
 }));
}

export function synchronizationSummary(node) {
 return node.moduleId === SYNCHRONIZE_MODULE
  ? 'Событий: '+node.parameters.eventCount+' · дождаться всех' : null;
}
