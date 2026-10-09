import { validateProject } from '../projects/model.js';
import { validateAssembly, boardFor } from '../assembly/model.js';
import { validateGraph, hardwareBinding } from '../logic/model.js';

const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const implementationKeys = {'clex.hardware.led':'gpio-led','clex.hardware.button':'gpio-button','clex.logic.timer':'timer','clex.logic.gpio-read':'gpio-read','clex.logic.gpio-set':'gpio-set','clex.logic.gpio-toggle':'gpio-toggle','clex.logic.serial':'serial'};
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
  if (!nodes.some(node=>node.moduleId==='clex.logic.timer') || !project.logic.edges.some(edge=>edge.dataType==='event')) throw new Error('Добавьте таймер и соедините его такт с действием.');
  for (const element of [...nodes,...components]) {
    const module = catalog.modules.find(module=>module.id===element.moduleId);
    if (!module || module.version !== '1.0.0' || element.moduleVersion !== module.version || !implementationKeys[module.id] || implementationKeys[module.id] !== module.firmware?.generatorKey) throw new Error(`Нет проверенной реализации генератора для ${element.moduleId} v${element.moduleVersion}.`);
  }
  const index = new Map(nodes.map((node,i)=>[node.id,i])), hardware = new Map(components.map((component,i)=>[component.id,i]));
  const inputEdge = (node, port) => project.logic.edges.find(edge=>edge.target===node.id&&edge.targetHandle===port);
  function dataExpression(edge) {
    const producer = nodes[index.get(edge.source)];
    if (edge.sourceHandle==='interval' && producer.moduleId==='clex.logic.timer') return `${producer.parameters.intervalMs}.0`;
    if (edge.dataType==='boolean') return `value_${index.get(edge.source)}`;
    if (edge.dataType==='text') return `text_${index.get(edge.source)}`;
    throw new Error('Выход значения не поддерживается генератором.');
  }
  const textLengths = new Map();
  function textLength(node) {
    if (textLengths.has(node.id)) return textLengths.get(node.id);
    const input = inputEdge(node,'text');
    const length = (input ? textLength(nodes[index.get(input.source)]) : new TextEncoder().encode(node.parameters.message).length) + (inputEdge(node,'number') ? 64 : 0) + 1;
    textLengths.set(node.id,length); return length;
  }
  for (const node of nodes.filter(node=>node.moduleId==='clex.logic.serial')) { cString(node.parameters.message); textLength(node); }
  if ([...textLengths.values()].reduce((sum,length)=>sum+length,0)>65536) throw new Error('Текстовые выходы требуют более 64 КиБ. Уменьшите число сообщений или длину текста.');
  const declarations = [], initializers = [], inputUpdates = [];
  for (let i=0;i<components.length;i++) {
    const component=components[i], assignment=project.gpioAssignments.find(assignment=>assignment.componentId===component.id);
    if (!assignment) throw new Error('Компонент не имеет назначения GPIO.');
    const gpio=assignment.gpio, led=component.moduleId==='clex.hardware.led';
    declarations.push(led ? `static bool gpio_state_${i};` : `static bool input_stable_${i}, input_raw_${i};\nstatic int64_t input_changed_${i};`);
    initializers.push(`  { gpio_config_t config = { .pin_bit_mask = 1ULL << ${gpio}, .mode = ${led?'GPIO_MODE_OUTPUT':'GPIO_MODE_INPUT'}, .pull_up_en = ${led?'GPIO_PULLUP_DISABLE':'GPIO_PULLUP_ENABLE'}, .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE }; ESP_ERROR_CHECK(gpio_config(&config)); }`);
    initializers.push(led ? `  ESP_ERROR_CHECK(gpio_set_level(${gpio}, gpio_state_${i}));` : `  input_stable_${i} = input_raw_${i} = gpio_get_level(${gpio}) != 0; input_changed_${i} = esp_timer_get_time();`);
    if (!led) inputUpdates.push(`  { bool raw = gpio_get_level(${gpio}) != 0; if (raw != input_raw_${i}) { input_raw_${i} = raw; input_changed_${i} = now; } if (now - input_changed_${i} >= ${Math.round(component.parameters.debounceMs*1000)}LL) input_stable_${i} = input_raw_${i}; }`);
  }
  nodes.forEach((node,i)=>{
    if (['clex.logic.gpio-read','clex.logic.gpio-toggle'].includes(node.moduleId)) declarations.push(`static bool value_${i};`);
    if (node.moduleId==='clex.logic.serial') declarations.push(`static char text_${i}[${textLengths.get(node.id)}];`);
  });
  const functions=nodes.map((node,i)=>{
    const calls = project.logic.edges.filter(edge=>edge.source===node.id&&edge.dataType==='event').sort((a,b)=>index.get(a.target)-index.get(b.target)).map(edge=>`  node_${index.get(edge.target)}();`);
    const binding=hardwareBinding(node,project,catalog), h=hardware.get(binding.component?.id), gpio=binding.gpio;
    const operations=[];
    if (node.moduleId==='clex.logic.gpio-read') operations.push(`  value_${i} = input_stable_${h};`);
    if (node.moduleId==='clex.logic.gpio-toggle') operations.push(`  gpio_state_${h} = !gpio_state_${h};`, `  ESP_ERROR_CHECK(gpio_set_level(${gpio}, gpio_state_${h}));`, `  value_${i} = gpio_state_${h};`);
    if (node.moduleId==='clex.logic.gpio-set') {
      const value=inputEdge(node,'value'); operations.push(`  gpio_state_${h} = ${value?dataExpression(value):node.parameters.defaultValue?'true':'false'};`, `  ESP_ERROR_CHECK(gpio_set_level(${gpio}, gpio_state_${h}));`);
    }
    if (node.moduleId==='clex.logic.serial') {
      const text=inputEdge(node,'text'), number=inputEdge(node,'number');
      operations.push(`  snprintf(text_${i}, sizeof(text_${i}), ${number?'"%s %.15g"':'"%s"'}, ${text?dataExpression(text):cString(node.parameters.message)}${number?`, (double)(${dataExpression(number)})`:''});`, `  ESP_LOGI("CLEX", "%s", text_${i});`);
    }
    return `static void node_${i}(void) {\n${[...operations,...calls].join('\n') || '  /* Timer without an action. */'}\n}`;
  });
  const timers=nodes.map((node,i)=>({node,i})).filter(item=>item.node.moduleId==='clex.logic.timer');
  const source = `/* Deterministic firmware generated by CLEX Flow. */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdatomic.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_err.h"
static QueueHandle_t timer_queue;
static atomic_uint dropped_events;
${declarations.join('\n')}
${nodes.map((_,i)=>`static void node_${i}(void) __attribute__((unused));`).join('\n')}
static void update_inputs(void) {
${inputUpdates.length?'  int64_t now = esp_timer_get_time();\n'+inputUpdates.join('\n'):'  /* No buttons in this project. */'}
}
${functions.join('\n\n')}
static void timer_callback(void *argument) {
  uint16_t event = *(const uint16_t *)argument;
  if (xQueueSend(timer_queue, &event, 0) != pdTRUE) atomic_fetch_add(&dropped_events, 1);
}
static void flow_worker(void *argument) {
  (void)argument;
  int64_t last_report = 0;
  unsigned dropped_total = 0;
  for (;;) {
    uint16_t event;
    bool available = xQueueReceive(timer_queue, &event, pdMS_TO_TICKS(5)) == pdTRUE;
    update_inputs();
    if (available) {
      switch (event) {
${timers.map(({i})=>`        case ${i}: node_${i}(); break;`).join('\n')}
        default: break;
      }
    }
    dropped_total += atomic_exchange(&dropped_events, 0);
    if (dropped_total && esp_timer_get_time() - last_report >= 1000000) { ESP_LOGW("CLEX", "Timer events dropped: %u", dropped_total); dropped_total = 0; last_report = esp_timer_get_time(); }
    if (available) vTaskDelay(1);
  }
}
void app_main(void) {
${initializers.join('\n')}
  timer_queue = xQueueCreate(128, sizeof(uint16_t));
  if (!timer_queue || xTaskCreate(flow_worker, "clex_flow", 8192, NULL, 5, NULL) != pdPASS) { ESP_LOGE("CLEX", "Cannot create worker"); abort(); }
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
  return { boardId: board.id, target: 'esp32s3', consoleMode, mainC: source, warnings: issues.filter(issue=>issue.severity==='warning'), files: {
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16)\nset(COMPONENTS main)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(clex_flow_firmware)\n',
    'main/CMakeLists.txt': 'idf_component_register(SRCS "main.c" INCLUDE_DIRS "." REQUIRES esp_driver_gpio esp_timer freertos log)\n',
    'main/main.c': source, 'sdkconfig.defaults': config,
  } };
}
export async function firmwareFingerprint(bundle) {
  const bytes = new TextEncoder().encode(JSON.stringify([bundle.boardId,bundle.consoleMode,bundle.mainC]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
