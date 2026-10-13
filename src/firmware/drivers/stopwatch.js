import { STOPWATCH_RUNTIME } from './esp-idf/stopwatch.js';

export function stopwatchFirmware(nodes, index) {
  const watches = nodes.filter(node => node.moduleId === 'clex.logic.stopwatch');
  const expressions = new Map(), textSizes = new Map(), textGlyphs = new Map(), operations = new Map(), extraFunctions = new Map();
  for (const node of watches) {
    const i = index.get(node.id), state = 'stopwatch_' + i;
    expressions.set(node.id, { text: state + '.text', seconds: state + '.seconds', running: state + '.running' });
    textSizes.set(node.id, { text: 32 });
    textGlyphs.set(node.id, '0123456789:');
    const action = command => '  if (clex_stopwatch_' + command + '(&' + state + ', esp_timer_get_time())) node_' + i + '_emit_changed();';
    operations.set(node.id, action('start'));
    extraFunctions.set(node.id, ['pause', 'reset'].map(command => '\nstatic void node_' + i + '_' + command + '(void) {\n' + action(command) + '\n}').join(''));
  }
  return {
    enabled: watches.length > 0, expressions, textSizes, textGlyphs, operations, extraFunctions,
    eventModules: new Set(watches.length ? ['clex.logic.stopwatch'] : []),
    textBudget: watches.length * 32,
    source: watches.length ? STOPWATCH_RUNTIME + watches.map(node => 'static clex_stopwatch_t stopwatch_' + index.get(node.id) + ';').join('\n') : '',
    initialize: watches.map(node => '  clex_stopwatch_initialize(&stopwatch_' + index.get(node.id) + ', ' + (node.parameters.autoStart ? 'true' : 'false') + ', esp_timer_get_time());').join('\n'),
    poll: watches.length ? '    { int64_t stopwatch_now = esp_timer_get_time();\n' + watches.map(node => '      if (clex_stopwatch_refresh(&stopwatch_' + index.get(node.id) + ', stopwatch_now)) node_' + index.get(node.id) + '_emit_changed();').join('\n') + '\n    }' : '',
  };
}
