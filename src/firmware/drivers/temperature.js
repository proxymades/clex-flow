import { TEMPERATURE_RUNTIME } from './esp-idf/temperature.js';

export function temperatureFirmware(nodes, index, target) {
  const sensors = nodes.filter(node => node.moduleId === 'clex.logic.temperature');
  const expressions = new Map(), textSizes = new Map(), textGlyphs = new Map(), operations = new Map();
  for (const node of sensors) {
    const i = index.get(node.id), state = 'temperature_' + i;
    expressions.set(node.id, { value: state + '.value', text: state + '.text', valid: state + '.valid', error: state + '.error' });
    textSizes.set(node.id, { text: 48, error: 96 });
    textGlyphs.set(node.id, '0123456789.- °CНет данных');
    operations.set(node.id, `  bool valid = clex_temperature_read(&${state});\n  node_${i}_emit_changed();\n  if (valid) node_${i}_emit_done(); else node_${i}_emit_failed();`);
  }
  return {
    enabled: sensors.length > 0, expressions, textSizes, textGlyphs, operations,
    features: sensors.length ? ['temperature-' + target] : [],
    headers: sensors.length ? '#include <math.h>\n#include "driver/temperature_sensor.h"' : '',
    source: sensors.length ? TEMPERATURE_RUNTIME + sensors.map(node => 'static clex_temperature_value_t temperature_' + index.get(node.id) + ' = {.value = NAN, .text = "Нет данных"};').join('\n') : '',
    initialize: sensors.length ? '  clex_temperature_initialize();' : '',
    poll: sensors.filter(node => node.parameters.autoRead).map(node => {
      const i = index.get(node.id);
      return `    if (esp_timer_get_time() >= temperature_${i}.due) {\n      temperature_${i}.due = esp_timer_get_time() + ${node.parameters.intervalMs}LL * 1000LL;\n      node_${i}();\n    }`;
    }).join('\n'),
  };
}
