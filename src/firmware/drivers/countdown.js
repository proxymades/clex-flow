import {COUNTDOWN_CORE} from './countdown-core.js';

export function countdownFirmware(nodes, index, {avr = false} = {}) {
  const blocks = nodes.filter(node => node.moduleId === 'clex.logic.countdown');
  const operations = new Map(), extraFunctions = new Map();
  const clock = avr ? 'millis()' : '(uint32_t)(esp_timer_get_time() / 1000)';
  for (const node of blocks) {
    const i = index.get(node.id), state = 'countdown_' + i;
    operations.set(node.id, '  clex_countdown_begin(&' + state + ', ' + clock + ');\n  node_' + i + '_emit_started();');
    extraFunctions.set(node.id, 'static void node_' + i + '_cancel(void) {\n  clex_countdown_cancel(&' + state + ');\n}');
  }
  return {
    enabled: blocks.length > 0, operations, extraFunctions,
    eventModules: new Set(blocks.length ? ['clex.logic.countdown'] : []),
    source: blocks.length ? COUNTDOWN_CORE + blocks.map(node => 'static clex_countdown_t countdown_' + index.get(node.id) + ';').join('\n') : '',
    prototypes: blocks.map(node => 'static void node_' + index.get(node.id) + '_cancel(void) __attribute__((unused));').join('\n'),
    poll: blocks.map(node => '    if (clex_countdown_expire(&countdown_' + index.get(node.id) + ', ' + clock + ', ' + Math.round(node.parameters.durationSeconds * 1000) + 'UL)) {\n      node_' + index.get(node.id) + '_emit_elapsed();\n    }').join('\n'),
    ram: blocks.length * 8,
  };
}
