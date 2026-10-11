import { networkFirmware, NETWORK_DEPENDENCIES } from './drivers/network.js';
import { screenFor, screenBindings, elementUpdatePort } from '../displays/model.js';
import { displayFirmware, supportsDisplayDriver, GRAPHICS_CONFIG, GRAPHICS_FILES, GRAPHICS_SOURCES } from './drivers/display.js';
import { validateProject } from '../projects/model.js';
import { validateAssembly, boardFor } from '../assembly/model.js';
import { validateGraph, hardwareBinding } from '../logic/model.js';

const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const implementationKeys = {'clex.hardware.led':'gpio-led','clex.hardware.button':'gpio-button','clex.logic.timer':'timer','clex.logic.gpio-read':'gpio-read','clex.logic.gpio-set':'gpio-set','clex.logic.gpio-toggle':'gpio-toggle','clex.logic.serial':'serial','clex.logic.display':'display-view','clex.logic.counter':'counter','clex.hardware.ethernet':'ethernet-interface','clex.logic.ethernet':'ethernet','clex.logic.internet-check':'internet-check'};
export const IMPLEMENTATIONS = Object.values(implementationKeys);
export function cString(value) {
  if (value.includes('\0')) throw new Error('Текст сообщения содержит нулевой байт.');
  return '"' + [...new TextEncoder().encode(value)].map(byte => byte === 34 ? '\\"' : byte === 92 ? '\\\\' : byte >= 32 && byte < 127 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, '0')}`).join('') + '"';
}

export function generateFirmware(project, catalog, consoleMode = 'usb') {
  validateProject(project);
  if (!['usb','uart'].includes(consoleMode)) throw new Error('Неизвестный режим последовательной консоли.');
  const issues = [...validateAssembly(project,catalog), ...validateGraph(project,catalog)];
  const errors = issues.filter(issue=>issue.severity==='error');
  if (errors.length) throw new Error(`Исправьте схему перед сборкой:\n${errors.map(issue=>issue.message).join('\n')}`);
  const board = boardFor(project,catalog);
  if (!['waveshare-esp32-s3-eth','espressif-devkitc-1-v1-1-n8r8'].includes(board.id)) throw new Error('Генератор поддерживает только проверенные профили ESP32-S3.');
  const nodes = [...project.logic.nodes].sort(compare), components = [...project.components].sort(compare);
  const graphics = displayFirmware(project, catalog, cString);
  const index = new Map(nodes.map((node,i)=>[node.id,i])), hardware = new Map(components.map((component,i)=>[component.id,i]));
  const network=networkFirmware(project,catalog,nodes,index,cString);
  if (!graphics.runtime && !network.runtime && (!nodes.some(node=>node.moduleId==='clex.logic.timer') || !project.logic.edges.some(edge=>edge.dataType==='event'))) throw new Error('Добавьте таймер и соедините его такт с действием.');
  for (const element of [...nodes,...components]) {
    const module = catalog.modules.find(module=>module.id===element.moduleId);
    if (!module || module.version !== '1.0.0' || element.moduleVersion !== module.version || ((module.display && !supportsDisplayDriver(module.display, board.platform)) || (!module.display && (!implementationKeys[module.id] || implementationKeys[module.id] !== module.firmware?.generatorKey)))) throw new Error(`Нет проверенной реализации генератора для ${element.moduleId} v${element.moduleVersion}.`);
  }
  const inputEdge = (node, port) => project.logic.edges.find(edge=>edge.target===node.id&&edge.targetHandle===port);
  function dataExpression(edge) {
    const registered=network.expressions.get(edge.source)?.[edge.sourceHandle];if(registered)return registered;
    const producer = nodes[index.get(edge.source)];
    if (edge.sourceHandle==='interval' && producer.moduleId==='clex.logic.timer') return `${producer.parameters.intervalMs}.0`;
    if (['boolean', 'number'].includes(edge.dataType)) return `value_${index.get(edge.source)}`;
    if (edge.dataType==='text') return `text_${index.get(edge.source)}`;
    throw new Error('Выход значения не поддерживается генератором.');
  }
  const textLengths = new Map();
  const producerTextLength = edge => network.textSizes.get(edge.source)?.[edge.sourceHandle] || textLength(nodes[index.get(edge.source)]);
  function textLength(node) {
    if (textLengths.has(node.id)) return textLengths.get(node.id);
    const input = inputEdge(node,'text');
    const length = (input ? producerTextLength(input) : new TextEncoder().encode(node.parameters.message).length) + (inputEdge(node,'number') ? 64 : 0) + 1;
    textLengths.set(node.id,length); return length;
  }
  for (const node of nodes.filter(node=>node.moduleId==='clex.logic.serial')) { cString(node.parameters.message); textLength(node); }
  const dynamicLengths = new Map();
  function textLiteral(node) {
    const edge = inputEdge(node, 'text');
    return edge ? network.textSizes.has(edge.source) ? '0123456789abcdef.:_-/ABCDEFGHIJKLMNOPQRSTUVWXYZ ' : textLiteral(nodes[index.get(edge.source)]) : node.parameters.message;
  }
  for (const node of nodes.filter(node => node.moduleId === 'clex.logic.display')) {
    const component = components.find(component => component.id === node.parameters.componentId);
    const display = catalog.modules.find(module => module.id === component.moduleId).display;
    for (const binding of screenBindings(screenFor(project, component.id))) {
      const element=binding.element;
      const edge = inputEdge(node, binding.id);
      const font = display.graphics.fonts.find(font => font.id === element.fontId);
      if (binding.type === 'text' && binding.channel !== 'state') {
        const literal = network.textSizes.has(edge.source) ? '0123456789abcdef.:_-/ABCDEFGHIJKLMNOPQRSTUVWXYZ ' : textLiteral(nodes[index.get(edge.source)]);
        if ([...literal].some(char => !font.ranges.some(([min, max]) => char.codePointAt(0) >= min && char.codePointAt(0) <= max))) throw new Error('Выбранный шрифт не содержит некоторые символы текста источника.');
      }
      const valueLength = edge.dataType === 'text' ? producerTextLength(edge) : 64;
      dynamicLengths.set(component.id + '/' + element.id, new TextEncoder().encode(element.prefix + element.suffix).length + Math.max(valueLength, new TextEncoder().encode(String(element.initialValue)).length) + 1);
    }
  }
  if ([...textLengths.values(), ...dynamicLengths.values()].reduce((sum,length)=>sum+length,0)>65536) throw new Error('Текстовые выходы требуют более 64 КиБ. Уменьшите число сообщений или длину текста.');
  const declarations = [], initializers = [], inputUpdates = [];
  for (let i=0;i<components.length;i++) {
    const component=components[i];
    if (catalog.modules.find(module=>module.id===component.moduleId)?.display || catalog.modules.find(module=>module.id===component.moduleId)?.network) continue;
    const assignment=project.gpioAssignments.find(assignment=>assignment.componentId===component.id);
    if (!assignment) throw new Error('Компонент не имеет назначения GPIO.');
    const gpio=assignment.gpio, led=component.moduleId==='clex.hardware.led';
    declarations.push(led ? `static bool gpio_state_${i};` : `static bool input_stable_${i}, input_raw_${i};\nstatic int64_t input_changed_${i};`);
    initializers.push(`  { gpio_config_t config = { .pin_bit_mask = 1ULL << ${gpio}, .mode = ${led?'GPIO_MODE_OUTPUT':'GPIO_MODE_INPUT'}, .pull_up_en = ${led?'GPIO_PULLUP_DISABLE':'GPIO_PULLUP_ENABLE'}, .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE }; ESP_ERROR_CHECK(gpio_config(&config)); }`);
    initializers.push(led ? `  ESP_ERROR_CHECK(gpio_set_level(${gpio}, gpio_state_${i}));` : `  input_stable_${i} = input_raw_${i} = gpio_get_level(${gpio}) != 0; input_changed_${i} = esp_timer_get_time();`);
    if (!led) inputUpdates.push(`  { bool raw = gpio_get_level(${gpio}) != 0; if (raw != input_raw_${i}) { input_raw_${i} = raw; input_changed_${i} = now; } if (now - input_changed_${i} >= ${Math.round(component.parameters.debounceMs*1000)}LL) input_stable_${i} = input_raw_${i}; }`);
  }
  nodes.forEach((node,i)=>{
    if (['clex.logic.gpio-read','clex.logic.gpio-toggle'].includes(node.moduleId)) declarations.push(`static bool value_${i};`);
    if (node.moduleId==='clex.logic.counter') declarations.push(`static int32_t value_${i} = ${node.parameters.initialValue};`);
    if (node.moduleId==='clex.logic.serial') declarations.push(`static char text_${i}[${textLengths.get(node.id)}];`);
  });
  const displayElements = node => node.moduleId === 'clex.logic.display' ? screenBindings(screenFor(project, node.parameters.componentId)) : [];
  const eventCall = edge => {
    const target = nodes[index.get(edge.target)];
    const element = displayElements(target).findIndex(item => elementUpdatePort(item.id) === edge.targetHandle);
    const suffix = target.moduleId === 'clex.logic.counter' && edge.targetHandle === 'reset' ? '_reset' : element >= 0 ? '_element_' + element : '';
    return `node_${index.get(edge.target)}${suffix}();`;
  };
  const functions=nodes.map((node,i)=>{
    const sourceEvents=project.logic.edges.filter(edge=>edge.source===node.id&&edge.dataType==='event');
    const eventFunctions = network.eventModules.has(node.moduleId) ? catalog.modules.find(module=>module.id===node.moduleId).outputs.filter(port=>port.type==='event').map(port=>`\nstatic void node_${i}_emit_${port.id}(void) {\n${sourceEvents.filter(edge=>edge.sourceHandle===port.id).sort((a,b)=>index.get(a.target)-index.get(b.target) || (a.targetHandle < b.targetHandle ? -1 : a.targetHandle > b.targetHandle ? 1 : 0)).map(edge=>`  ${eventCall(edge)}`).join('\n') || '  /* Unconnected event. */'}\n}`) : [];
    const calls = (network.eventModules.has(node.moduleId) ? [] : sourceEvents).sort((a,b)=>index.get(a.target)-index.get(b.target) || (a.targetHandle < b.targetHandle ? -1 : a.targetHandle > b.targetHandle ? 1 : 0)).map(edge=>`  ${eventCall(edge)}`);
    const binding=hardwareBinding(node,project,catalog), h=hardware.get(binding.component?.id), gpio=binding.gpio;
    const operations=[], elementFunctions=[];
    if (node.moduleId==='clex.logic.counter') operations.push(`  int64_t next = (int64_t)value_${i} + (${node.parameters.step}LL);`, `  value_${i} = (int32_t)(next > INT32_MAX ? INT32_MAX : next < INT32_MIN ? INT32_MIN : next);`);
    if (node.moduleId==='clex.logic.gpio-read') operations.push(`  value_${i} = input_stable_${h};`);
    if (node.moduleId==='clex.logic.gpio-toggle') operations.push(`  gpio_state_${h} = !gpio_state_${h};`, `  ESP_ERROR_CHECK(gpio_set_level(${gpio}, gpio_state_${h}));`, `  value_${i} = gpio_state_${h};`);
    if (node.moduleId==='clex.logic.gpio-set') {
      const value=inputEdge(node,'value'); operations.push(`  gpio_state_${h} = ${value?dataExpression(value):node.parameters.defaultValue?'true':'false'};`, `  ESP_ERROR_CHECK(gpio_set_level(${gpio}, gpio_state_${h}));`);
    }
    if (node.moduleId==='clex.logic.serial') {
      const text=inputEdge(node,'text'), number=inputEdge(node,'number');
      operations.push(`  snprintf(text_${i}, sizeof(text_${i}), ${number?'"%s %.15g"':'"%s"'}, ${text?dataExpression(text):cString(node.parameters.message)}${number?`, (double)(${dataExpression(number)})`:''});`, `  ESP_LOGI("CLEX", "%s", text_${i});`);
    }
    if (node.moduleId==='clex.logic.display') {
      const elements = displayElements(node);
      for (const [j, binding] of elements.entries()) {
        const element=binding.element, edge = inputEdge(node, binding.id), expression = dataExpression(edge);
        const setter = element.type==='indicator' ? binding.channel==='caption' ? 'clex_graphics_set_indicator_caption' : 'clex_graphics_set_indicator_state' : 'clex_graphics_set_text';
        const statement = binding.type === 'number' ? `  { char number[64]; snprintf(number, sizeof(number), "%.15g", (double)(${expression})); ${setter}(${cString(node.parameters.componentId)}, ${cString(element.id)}, number); }` : `  ${setter}(${cString(node.parameters.componentId)}, ${cString(element.id)}, ${binding.type === 'boolean' ? `(${expression}) ? ${cString(element.type==='indicator'?'true':'Да')} : ${cString(element.type==='indicator'?'false':'Нет')}` : expression});`;
        operations.push(statement);
        elementFunctions.push(`\nstatic void node_${i}_element_${j}(void) {\n${statement}\n}`);
      }
    }
    const reset = node.moduleId==='clex.logic.counter' ? `\nstatic void node_${i}_reset(void) {\n  value_${i} = ${node.parameters.initialValue};\n${calls.join('\n')}\n}` : '';
    return `static void node_${i}(void) {\n${[...operations,...calls].join('\n') || '  /* No actions for this node. */'}\n}${reset}${elementFunctions.join('')}${eventFunctions.join('')}`;
  });
  const timers=nodes.map((node,i)=>({node,i})).filter(item=>item.node.moduleId==='clex.logic.timer');
  const source = `/* Deterministic firmware generated by CLEX Flow. */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdatomic.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_err.h"
${network.headers}
${graphics.source}
${network.types ? network.types+'\n' : ''}static QueueHandle_t timer_queue;
static atomic_uint dropped_events;
${declarations.join('\n')}
${network.source}
${nodes.map((node,i)=>`static void node_${i}(void) __attribute__((unused));${node.moduleId === 'clex.logic.counter' ? `\nstatic void node_${i}_reset(void) __attribute__((unused));` : ''}${displayElements(node).map((_, j) => `\nstatic void node_${i}_element_${j}(void) __attribute__((unused));`).join('')}${network.eventModules.has(node.moduleId)?catalog.modules.find(module=>module.id===node.moduleId).outputs.filter(port=>port.type==='event').map(port=>`\nstatic void node_${i}_emit_${port.id}(void) __attribute__((unused));`).join(''):''}`).join('\n')}
static void update_inputs(void) {
${inputUpdates.length?'  int64_t now = esp_timer_get_time();\n'+inputUpdates.join('\n'):'  /* No buttons in this project. */'}
}
${functions.join('\n\n')}
static void __attribute__((unused)) timer_callback(void *argument) {
  ${network.runtime?'clex_flow_event_t event = {.node = *(const uint16_t *)argument};':'uint16_t event = *(const uint16_t *)argument;'}
  if (xQueueSend(timer_queue, &event, 0) != pdTRUE) atomic_fetch_add(&dropped_events, 1);
}
static void flow_worker(void *argument) {
  (void)argument;
  int64_t last_report = 0;
  unsigned dropped_total = 0;
  for (;;) {
    ${network.runtime?'clex_flow_event_t':'uint16_t'} event;
    bool available = xQueueReceive(timer_queue, &event, pdMS_TO_TICKS(5)) == pdTRUE;
    update_inputs();
    if (available) {
      switch (${network.runtime?'event.node':'event'}) {
${timers.map(({i})=>`        case ${i}: node_${i}(); break;`).join('\n')}
${network.dispatch.join('\n')}
        default: break;
      }
    }
${graphics.update}
    dropped_total += atomic_exchange(&dropped_events, 0);
    if (dropped_total && esp_timer_get_time() - last_report >= 1000000) { ESP_LOGW("CLEX", "Timer events dropped: %u", dropped_total); dropped_total = 0; last_report = esp_timer_get_time(); }
    if (available) vTaskDelay(1);
  }
}
void app_main(void) {
${graphics.initialize}
${initializers.join('\n')}
  timer_queue = xQueueCreate(128, sizeof(${network.runtime?'clex_flow_event_t':'uint16_t'}));
  if (!timer_queue || xTaskCreate(flow_worker, "clex_flow", 8192, NULL, 5, NULL) != pdPASS) { ESP_LOGE("CLEX", "Cannot create worker"); abort(); }
${network.initialize}
${network.start}
${timers.map(({node,i})=>`  static const uint16_t timer_node_${i} = ${i};
  esp_timer_handle_t timer_${i};
  esp_timer_create_args_t args_${i} = { .callback = timer_callback, .arg = (void *)&timer_node_${i}, .dispatch_method = ESP_TIMER_TASK, .name = "clex_${i}", .skip_unhandled_events = true };
  ESP_ERROR_CHECK(esp_timer_create(&args_${i}, &timer_${i}));
  ESP_ERROR_CHECK(esp_timer_start_periodic(timer_${i}, ${node.parameters.intervalMs}ULL * 1000ULL));`).join('\n')}
  ESP_LOGI("CLEX", "Flow ready: ${nodes.length} blocks, ${timers.length} timers");
}
`;
  const flashSize = board.id==='waveshare-esp32-s3-eth'?16:8;
  const config = `CONFIG_IDF_TARGET="esp32s3"\nCONFIG_ESPTOOLPY_FLASHSIZE_${flashSize}MB=y\nCONFIG_ESPTOOLPY_FLASHMODE_DIO=y\nCONFIG_FREERTOS_HZ=1000\nCONFIG_LOG_COLORS=n\nCONFIG_ESP_CONSOLE_${consoleMode==='usb'?'USB_SERIAL_JTAG':'UART_DEFAULT'}=y\nCONFIG_ESP_CONSOLE_SECONDARY_NONE=y\n`;
  const graphicsFiles = graphics.runtime ? { ...GRAPHICS_FILES, 'main/idf_component.yml': 'dependencies:\n  lvgl/lvgl: "=9.2.2"\n' } : {};
  const requirements='esp_driver_gpio esp_timer freertos log' + (graphics.runtime?' esp_lcd esp_driver_spi lvgl__lvgl':'') + (network.runtime?' esp_driver_spi '+NETWORK_DEPENDENCIES:'');
  const dependencyList=[...new Set(requirements.split(' '))].join(' ');
  return { networkRuntime:network.runtime, graphicsRuntime: graphics.runtime, boardId: board.id, target: 'esp32s3', consoleMode, mainC: source, warnings: issues.filter(issue=>issue.severity==='warning'), files: {
    ...graphicsFiles,
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16)\nset(COMPONENTS main)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(clex_flow_firmware)\n',
    'main/CMakeLists.txt': 'idf_component_register(SRCS "main.c"' + (graphics.runtime?' '+GRAPHICS_SOURCES:'') + ' INCLUDE_DIRS "." REQUIRES '+dependencyList+')\n',
    ...(network.partitions?{'partitions.csv':network.partitions}:{}),
    'main/main.c': source, 'sdkconfig.defaults': config + (graphics.runtime ? GRAPHICS_CONFIG : '') + network.config,
  } };
}
export async function firmwareFingerprint(bundle) {
  const identity=[bundle.boardId,bundle.consoleMode,bundle.mainC];if(bundle.graphicsRuntime)identity.push(bundle.graphicsRuntime);if(bundle.networkRuntime)identity.push(bundle.networkRuntime);
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
