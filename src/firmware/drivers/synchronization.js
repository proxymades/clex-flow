import {SYNCHRONIZE_MODULE} from '../../logic/synchronization.js';
import {SYNCHRONIZATION_CORE} from './synchronization-core.js';

export function synchronizationFirmware(nodes,index) {
 const blocks = nodes.filter(node=>node.moduleId===SYNCHRONIZE_MODULE);
 const operations = new Map(), extraFunctions = new Map();
 const variable = node=>'sync_'+index.get(node.id);
 for (const node of blocks) {
  const i=index.get(node.id),state=variable(node),p=node.parameters;
  operations.set(node.id,
   '  clex_sync_begin(&'+state+', '+p.eventCount+', (uint64_t)(esp_timer_get_time() / 1000));'+
   '\n  node_'+i+'_emit_started();');
  extraFunctions.set(node.id,() =>
   'static void node_'+i+'_cancel(void) { '+state+'.active = false; }\n'+
   Array.from({length:p.eventCount},(_,slot)=>
    'static void node_'+i+'_event'+(slot+1)+'(void) {\n'+
    '  unsigned result = clex_sync_receive(&'+state+', '+slot+', (uint64_t)(esp_timer_get_time() / 1000), '+p.timeoutMs+');\n'+
    '  if (result == 1) { node_'+i+'_emit_done(); }\n'+
    '  else if (result == 2) { node_'+i+'_emit_timedOut(); }\n}'
   ).join('\n'));
 }
 return {
  enabled:blocks.length>0, operations, extraFunctions,
  eventModules:new Set(blocks.length?[SYNCHRONIZE_MODULE]:[]),
  source:blocks.length?SYNCHRONIZATION_CORE+'\n'+blocks.map(node=>'static clex_sync_t '+variable(node)+';').join('\n'):'',
  prototypes:blocks.flatMap(node=>['cancel',...Array.from({length:node.parameters.eventCount},(_,i)=>'event'+(i+1))].map(action=>'static void node_'+index.get(node.id)+'_'+action+'(void) __attribute__((unused));')).join('\n'),
  poll:blocks.filter(node=>node.parameters.timeoutMs>0).map(node=>'    if (clex_sync_expire(&'+variable(node)+', (uint64_t)(esp_timer_get_time() / 1000), '+node.parameters.timeoutMs+')) { node_'+index.get(node.id)+'_emit_timedOut(); }').join('\n'),
 };
}
