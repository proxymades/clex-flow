import {mqttFirmware} from './drivers/mqtt.js';
import componentPackages from './component-files.json' with { type: 'json' };
import {routerFirmware} from './drivers/router.js';
import {temperatureFirmware} from './drivers/temperature.js';
import {stepperFirmware} from './drivers/stepper.js';
import {gpioEdgeFirmware} from './drivers/gpio-edge.js';
import {selectNumberCode} from './drivers/select-number.js';
import {espNowFirmware} from './drivers/espnow.js';
import { generateArduinoAvr } from './platforms/arduino-avr.js';
import profiles from './runtime-profiles.json' with { type: 'json' };
import { peripheralBuses } from './drivers/peripheral-buses.js';
import { stopwatchFirmware } from './drivers/stopwatch.js';
import { mediaFirmware, MEDIA_TYPES } from './drivers/media.js';
import { networkFirmware, NETWORK_DEPENDENCIES } from './drivers/network.js';
import { screenFor, screenBindings, elementUpdatePort } from '../displays/model.js';
import { displayFirmware, supportsDisplayDriver, GRAPHICS_CONFIG, GRAPHICS_FILES, GRAPHICS_SOURCES } from './drivers/display.js';
import { validateProject } from '../projects/model.js';
import { validateAssembly, boardFor } from '../assembly/model.js';
import { validateGraph, hardwareBinding, nodePorts } from '../logic/model.js';

const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const implementationKeys = {'clex.hardware.nema17':'stepper','clex.hardware.tb6600':'stepper','clex.hardware.tmc2208':'stepper','clex.hardware.drv8825':'stepper','clex.logic.stepper':'stepper','clex.hardware.touch-button':'gpio-input','clex.logic.gpio-edge':'gpio-edge',"clex.hardware.espnow":"espnow-interface","clex.logic.espnow-control":"espnow-control","clex.logic.espnow-receive":"espnow-receive","clex.logic.espnow-ack":"espnow-ack","clex.logic.espnow-send":"espnow-send",'clex.hardware.led':'gpio-led','clex.hardware.button':'gpio-button','clex.logic.timer':'timer','clex.logic.gpio-read':'gpio-read','clex.logic.gpio-set':'gpio-set','clex.logic.gpio-toggle':'gpio-toggle','clex.logic.serial':'serial','clex.logic.display':'display-view','clex.logic.counter':'counter','clex.logic.stopwatch':'stopwatch','clex.hardware.ethernet':'ethernet-interface','clex.logic.ethernet':'ethernet','clex.logic.internet-check':'internet-check','clex.hardware.audio':'audio-interface','clex.hardware.camera':'camera-interface','clex.logic.tone':'tone','clex.logic.camera-capture':'camera-capture'};
const implementationVersions = {
  'clex.hardware.espnow':'2.0.0',
  'clex.logic.espnow-send':'2.0.0',
  'clex.logic.espnow-receive':'2.0.0',
  'clex.logic.espnow-ack':'2.0.0',
  'clex.logic.espnow-control':'2.0.0',
};
implementationKeys['clex.hardware.mqtt']='mqtt-interface';
for(const action of ['control','send','receive'])implementationKeys['clex.logic.mqtt-'+action]='mqtt-'+action;
implementationKeys['clex.hardware.router']='router';
implementationKeys['clex.logic.router']='router';
implementationKeys['clex.logic.temperature']='temperature';
implementationKeys['clex.logic.select-number'] = 'select-number';
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
  if(board.platform==='arduino-avr')return generateArduinoAvr(project,catalog,board,cString,issues);
  if (board.platform !== 'esp-idf' || !board.firmware || !['esp32','esp32s3','esp32p4'].includes(board.target)) throw new Error('Для платы нет реализованного профиля генератора.');
  const modes = board.firmware.consoleModes;
  if (!modes.includes(consoleMode)) consoleMode = modes[0];
  const boardRevision = board.firmware.revisionConfigs ? project.boardSettings.chipRevision || board.options.chipRevision.default : null;
  if (boardRevision && !Object.hasOwn(board.firmware.revisionConfigs, boardRevision)) throw new Error('Выберите поддерживаемую ревизию микроконтроллера.');
  const nodes = [...project.logic.nodes].sort(compare), components = [...project.components].sort(compare);
  const graphics = displayFirmware(project, catalog, cString);
  const index = new Map(nodes.map((node,i)=>[node.id,i])), hardware = new Map(components.map((component,i)=>[component.id,i]));
  const gpioEdge=gpioEdgeFirmware(project,catalog,nodes,index,hardware);
  const network=networkFirmware(project,catalog,nodes,index,cString);
  const router=routerFirmware(project,catalog,nodes,index,cString);
  const mqtt=mqttFirmware(project,catalog,nodes,index,cString);
  const temperature=temperatureFirmware(nodes,index,board.target);
  const espnow=espNowFirmware(project,nodes,index,cString,Boolean(network.runtime),board.target);
  const stepper=stepperFirmware(project,nodes,index);
  const media=mediaFirmware(project,catalog,nodes,index);
  const stopwatch=stopwatchFirmware(nodes,index);
  const buses=peripheralBuses(project,catalog);
  const events=Boolean(network.runtime || media.enabled);
  const eventModules=new Set([...network.eventModules,...media.eventModules,...stopwatch.eventModules,...espnow.eventModules,...gpioEdge.eventModules,...mqtt.eventModules,'clex.logic.router','clex.logic.temperature','clex.logic.stepper','clex.logic.select-number']);
  const eventTypes=media.enabled ? MEDIA_TYPES+'\n'+(network.types ? network.types.replace('clex_ethernet_snapshot_t ethernet;', 'clex_media_snapshot_t media; clex_ethernet_snapshot_t ethernet;') : 'typedef struct { uint16_t node; uint8_t kind,flags; uint32_t generation; union { clex_media_snapshot_t media; } payload; } clex_flow_event_t;') : network.types;
  const featureRuntimes=[...new Set([...(graphics.features||[]),...media.features,...espnow.features,...router.features,...temperature.features,...mqtt.features,...(stepper.enabled?["stepper-"+board.target]:[])])].sort();
  const extraProfiles=featureRuntimes.map(feature=>{const profile=profiles[feature];if(!profile || profile.target!==board.target)throw new Error('Неподдерживаемая комбинация драйвера и платы.');return profile;});
  const componentNames=[...new Set(extraProfiles.flatMap(profile=>profile.components||[]))].sort();
  const componentFiles=Object.assign({},...componentNames.map(name=>{if(!componentPackages[name])throw new Error('Отсутствуют исходники компонента '+name);return componentPackages[name].files;}));
  const extraConfig=[...new Set(extraProfiles.filter(profile=>profile.config.trim()).flatMap(profile=>profile.config.trim().split('\n')))].join('\n')+(featureRuntimes.length?'\n':'');
  if (!graphics.runtime && !network.runtime && !media.enabled && !stopwatch.enabled && !espnow.enabled && !gpioEdge.enabled && !stepper.enabled && !router.enabled && !temperature.enabled && !mqtt.enabled && (!nodes.some(node=>node.moduleId==='clex.logic.timer') || !project.logic.edges.some(edge=>edge.dataType==='event'))) throw new Error('Добавьте таймер и соедините его такт с действием.');
  for (const element of [...nodes,...components]) {
    const module = catalog.modules.find(module=>module.id===element.moduleId);
    if (!module || module.version !== (implementationVersions[module.id] || '1.0.0') || element.moduleVersion !== module.version || ((module.display && !supportsDisplayDriver(module.display, board.platform)) || (!module.display && (!implementationKeys[module.id] || implementationKeys[module.id] !== module.firmware?.generatorKey)))) throw new Error(`Нет проверенной реализации генератора для ${element.moduleId} v${element.moduleVersion}.`);
  }
  const inputEdge = (node, port) => project.logic.edges.find(edge=>edge.target===node.id&&edge.targetHandle===port);
  function dataExpression(edge) {
    if(temperature.expressions.has(edge.source))return temperature.expressions.get(edge.source)[edge.sourceHandle];
    if(stepper.expressions.has(edge.source))return stepper.expressions.get(edge.source)[edge.sourceHandle];
    const registered=mqtt.expressions.get(edge.source)?.[edge.sourceHandle] || router.expressions.get(edge.source)?.[edge.sourceHandle] || gpioEdge.expressions.get(edge.source)?.[edge.sourceHandle] || espnow.expressions.get(edge.source)?.[edge.sourceHandle] || network.expressions.get(edge.source)?.[edge.sourceHandle] || media.expressions.get(edge.source)?.[edge.sourceHandle] || stopwatch.expressions.get(edge.source)?.[edge.sourceHandle];if(registered)return registered;
    const producer = nodes[index.get(edge.source)];
    if (edge.sourceHandle==='interval' && producer.moduleId==='clex.logic.timer') return `${producer.parameters.intervalMs}.0`;
    if (['boolean', 'number'].includes(edge.dataType)) return `value_${index.get(edge.source)}`;
    if (edge.dataType==='text') return `text_${index.get(edge.source)}`;
    throw new Error('Выход значения не поддерживается генератором.');
  }
  const runtimeTextSizes = new Map([...mqtt.textSizes,...temperature.textSizes,...router.textSizes,...network.textSizes, ...media.textSizes, ...stopwatch.textSizes,...espnow.textSizes,...stepper.textSizes]);
  const runtimeTextGlyphs = '0123456789.:_-/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';
  const runtimeGlyphsFor = id => stopwatch.textGlyphs.get(id) || runtimeTextGlyphs+(temperature.textGlyphs.get(id)||'')+(espnow.textGlyphs.get(id)||'')+(stepper.textGlyphs.get(id)||'')+(mqtt.textGlyphs.get(id)||'');
  const textLengths = new Map();
  const producerTextLength = edge => runtimeTextSizes.get(edge.source)?.[edge.sourceHandle] || textLength(nodes[index.get(edge.source)]);
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
    return edge ? runtimeTextSizes.has(edge.source) ? runtimeGlyphsFor(edge.source) : textLiteral(nodes[index.get(edge.source)]) : node.parameters.message;
  }
  for (const node of nodes.filter(node => node.moduleId === 'clex.logic.display')) {
    const component = components.find(component => component.id === node.parameters.componentId);
    const display = catalog.modules.find(module => module.id === component.moduleId).display;
    for (const binding of screenBindings(screenFor(project, component.id))) {
      const element=binding.element;
      const edge = inputEdge(node, binding.id);
      const font = display.graphics.fonts.find(font => font.id === element.fontId);
      if (binding.type === 'text' && binding.channel !== 'state') {
        const literal = runtimeTextSizes.has(edge.source) ? runtimeGlyphsFor(edge.source) : textLiteral(nodes[index.get(edge.source)]);
        if ([...literal].some(char => !font.ranges.some(([min, max]) => char.codePointAt(0) >= min && char.codePointAt(0) <= max))) throw new Error('Выбранный шрифт не содержит некоторые символы текста источника.');
      }
      const valueLength = edge.dataType === 'text' ? producerTextLength(edge) : 64;
      dynamicLengths.set(component.id + '/' + element.id, new TextEncoder().encode(element.prefix + element.suffix).length + Math.max(valueLength, new TextEncoder().encode(String(element.initialValue)).length) + 1);
    }
  }
  if ([...textLengths.values(), ...dynamicLengths.values()].reduce((sum,length)=>sum+length,0)+stopwatch.textBudget>65536) throw new Error('Текстовые выходы требуют более 64 КиБ. Уменьшите число сообщений или длину текста.');
  const declarations = [], initializers = [], inputUpdates = [];
  for (let i=0;i<components.length;i++) {
    const component=components[i];
    if (catalog.modules.find(module=>module.id===component.moduleId)?.display || catalog.modules.find(module=>module.id===component.moduleId)?.network || catalog.modules.find(module=>module.id===component.moduleId)?.hardwareInterface || catalog.modules.find(module=>module.id===component.moduleId)?.softwareInterface || catalog.modules.find(module=>module.id===component.moduleId)?.stepper || catalog.modules.find(module=>module.id===component.moduleId)?.passive) continue;
    const assignment=project.gpioAssignments.find(assignment=>assignment.componentId===component.id);
    if (!assignment) throw new Error('Компонент не имеет назначения GPIO.');
    const gpio=assignment.gpio, led=component.moduleId==='clex.hardware.led', sample=`gpio_get_level(${gpio}) ${component.parameters.activeLevel==='low'?'== 0':'!= 0'}`;
    declarations.push(led ? `static bool gpio_state_${i};` : `static bool input_stable_${i}, input_raw_${i};\nstatic int64_t input_changed_${i};`);
    initializers.push(`  { gpio_config_t config = { .pin_bit_mask = 1ULL << ${gpio}, .mode = ${led?'GPIO_MODE_OUTPUT':'GPIO_MODE_INPUT'}, .pull_up_en = ${!led && component.parameters.pull==='up'?'GPIO_PULLUP_ENABLE':'GPIO_PULLUP_DISABLE'}, .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE }; ESP_ERROR_CHECK(gpio_config(&config)); }`);
    initializers.push(led ? `  ESP_ERROR_CHECK(gpio_set_level(${gpio}, gpio_state_${i}));` : `  input_stable_${i} = input_raw_${i} = ${sample}; input_changed_${i} = esp_timer_get_time();`);
    if (!led) inputUpdates.push(`  { bool raw = ${sample}; if (raw != input_raw_${i}) { input_raw_${i} = raw; input_changed_${i} = now; } if (now - input_changed_${i} >= ${Math.round(component.parameters.debounceMs*1000)}LL) input_stable_${i} = input_raw_${i}; }`);
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
    const suffix = (target.moduleId==='clex.logic.mqtt-control'&&edge.targetHandle==='disconnect')||(target.moduleId==='clex.logic.mqtt-receive'&&edge.targetHandle==='unsubscribe')?'_'+edge.targetHandle:target.moduleId==='clex.logic.router'&&edge.targetHandle!=='trigger'?'_'+edge.targetHandle:target.moduleId==='clex.logic.stepper'&&['stop','release'].includes(edge.targetHandle)?'_'+edge.targetHandle:target.moduleId==='clex.logic.espnow-control'&&edge.targetHandle==='resetStatistics'?'_resetStatistics':target.moduleId==='clex.logic.espnow-ack'&&edge.targetHandle==='reject'?'_reject':target.moduleId === 'clex.logic.counter' && edge.targetHandle === 'reset' ? '_reset' : target.moduleId === 'clex.logic.stopwatch' && ['pause','reset'].includes(edge.targetHandle) ? '_' + edge.targetHandle : element >= 0 ? '_element_' + element : '';
    return `node_${index.get(edge.target)}${suffix}();`;
  };
  const functions=nodes.map((node,i)=>{
    const sourceEvents=project.logic.edges.filter(edge=>edge.source===node.id&&edge.dataType==='event');
    const eventFunctions = eventModules.has(node.moduleId) ? nodePorts(node,catalog,project).outputs.filter(port=>port.type==='event').map(port=>`\nstatic void node_${i}_emit_${port.id}(void) {\n${sourceEvents.filter(edge=>edge.sourceHandle===port.id).sort((a,b)=>index.get(a.target)-index.get(b.target) || (a.targetHandle < b.targetHandle ? -1 : a.targetHandle > b.targetHandle ? 1 : 0)).map(edge=>`  ${eventCall(edge)}`).join('\n') || '  /* Unconnected event. */'}\n}`) : [];
    const calls = (eventModules.has(node.moduleId) ? [] : sourceEvents).sort((a,b)=>index.get(a.target)-index.get(b.target) || (a.targetHandle < b.targetHandle ? -1 : a.targetHandle > b.targetHandle ? 1 : 0)).map(edge=>`  ${eventCall(edge)}`);
    const binding=hardwareBinding(node,project,catalog), h=hardware.get(binding.component?.id), gpio=binding.gpio;
    const operations=[], elementFunctions=[];
    if(mqtt.operations.has(node.id)){const op=mqtt.operations.get(node.id);operations.push(typeof op==='function'?op({inputEdge,dataExpression}):op);}
    if(temperature.operations.has(node.id))operations.push(temperature.operations.get(node.id));
    if (node.moduleId === 'clex.logic.select-number') operations.push(selectNumberCode(node, dataExpression(inputEdge(node, 'value')), port => `    node_${i}_emit_${port}();`));
    if(router.operations.has(node.id))operations.push(router.operations.get(node.id));
    if(stepper.operations.has(node.id))operations.push(stepper.operations.get(node.id));
    if(espnow.operations.has(node.id)){const op=espnow.operations.get(node.id);operations.push(typeof op==='function'?op({inputEdge,dataExpression}):op);}
    if (media.operations.has(node.id)) operations.push(media.operations.get(node.id));
    if (stopwatch.operations.has(node.id)) operations.push(stopwatch.operations.get(node.id));
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
    return `static void node_${i}(void) {\n${[...operations,...calls].join('\n') || '  /* No actions for this node. */'}\n}${reset}${stopwatch.extraFunctions.get(node.id) || ''}${elementFunctions.join('')}${eventFunctions.join('')}`;
  });
  const timers=nodes.map((node,i)=>({node,i})).filter(item=>item.node.moduleId==='clex.logic.timer');
  const source = `/* Deterministic firmware generated by CLEX Flow. */
${componentNames.map(name=>'/* '+name+' source SHA-256: '+componentPackages[name].digest+' */\n').join('')}#include <stdbool.h>
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
${stepper.headers}
${router.headers}
${temperature.headers}
${mqtt.headers}
${network.headers}${espnow.headers?'\n'+espnow.headers:''}
${buses.source}
${graphics.source}
${eventTypes ? eventTypes+'\n' : ''}static QueueHandle_t timer_queue;
static atomic_uint dropped_events;
${mqtt.enabled?'static atomic_bool clex_flow_ready;\n':''}${declarations.join('\n')}
${network.source}${espnow.source?'\n'+espnow.source:''}${gpioEdge.source?'\n'+gpioEdge.source:''}
${media.source}
${stepper.source}
${router.source}
${temperature.source}
${mqtt.source}
${stopwatch.source ? stopwatch.source+'\n' : ''}${nodes.map((node,i)=>`static void node_${i}(void) __attribute__((unused));${node.moduleId === 'clex.logic.espnow-ack' ? `\nstatic void node_${i}_reject(void) __attribute__((unused));` : ''}${node.moduleId === 'clex.logic.counter' ? `\nstatic void node_${i}_reset(void) __attribute__((unused));` : ''}${node.moduleId === 'clex.logic.stopwatch' ? `\nstatic void node_${i}_pause(void) __attribute__((unused));\nstatic void node_${i}_reset(void) __attribute__((unused));` : ''}${displayElements(node).map((_, j) => `\nstatic void node_${i}_element_${j}(void) __attribute__((unused));`).join('')}${eventModules.has(node.moduleId)?nodePorts(node,catalog,project).outputs.filter(port=>port.type==='event').map(port=>`\nstatic void node_${i}_emit_${port.id}(void) __attribute__((unused));`).join(''):''}`).join('\n')}
${nodes.filter(node=>node.moduleId==='clex.logic.espnow-control'&&node.parameters.action==='peer').map(node=>`static void node_${index.get(node.id)}_resetStatistics(void) __attribute__((unused));`).join('\n')}
${nodes.filter(node=>node.moduleId==='clex.logic.stepper').flatMap(node=>['stop','release'].map(action=>`static void node_${index.get(node.id)}_${action}(void) __attribute__((unused));`)).join('\n')}
${nodes.filter(node=>node.moduleId==='clex.logic.router').flatMap(node=>['start','stop','apOn','apOff','reconnect','clients','applyAp','applyWan'].map(action=>`static void node_${index.get(node.id)}_${action}(void) __attribute__((unused));`)).join('\n')}
${nodes.filter(node=>mqtt.extraFunctions.has(node.id)).map(node=>`static void node_${index.get(node.id)}_${node.moduleId==='clex.logic.mqtt-control'?'disconnect':'unsubscribe'}(void) __attribute__((unused));`).join('\n')}
static void update_inputs(void) {
${inputUpdates.length?'  int64_t now = esp_timer_get_time();\n'+inputUpdates.join('\n'):'  /* No buttons in this project. */'}
}
${functions.join('\n\n')}
${[...stepper.extraFunctions.values()].join('\n')}${stepper.notify}
${nodes.filter(node=>router.extraFunctions.has(node.id)).map(node=>router.extraFunctions.get(node.id)({inputEdge,dataExpression,cString})).join('\n')}${router.notify}
${espnow.enabled?'\n'+[...espnow.extraFunctions.values()].join('\n')+'\n'+espnow.notify:''}
${[...mqtt.extraFunctions.values()].join('\n')}${mqtt.notify}
static void __attribute__((unused)) timer_callback(void *argument) {
  ${events?'clex_flow_event_t event = {.node = *(const uint16_t *)argument};':'uint16_t event = *(const uint16_t *)argument;'}
  if (xQueueSend(timer_queue, &event, 0) != pdTRUE) atomic_fetch_add(&dropped_events, 1);
}
static void flow_worker(void *argument) {
  (void)argument;
  int64_t last_report = 0;
  unsigned dropped_total = 0;
  for (;;) {
${mqtt.enabled?'    if (!atomic_load(&clex_flow_ready)) { vTaskDelay(1); continue; }\n':''}    ${events?'clex_flow_event_t':'uint16_t'} event;
    bool available = xQueueReceive(timer_queue, &event, pdMS_TO_TICKS(5)) == pdTRUE;
    update_inputs();
    if (available) {
      switch (${events?'event.node':'event'}) {
${timers.map(({i})=>`        case ${i}: node_${i}(); break;`).join('\n')}
${network.dispatch.join('\n')}
${media.dispatch.join('\n')}
        default: break;
      }
    }
${stepper.poll}
${router.poll}
${temperature.poll}
${mqtt.poll}
${gpioEdge.poll?gpioEdge.poll+'\n':''}${espnow.poll?espnow.poll+'\n':''}${stopwatch.poll ? stopwatch.poll+'\n' : ''}${graphics.update}
    dropped_total += atomic_exchange(&dropped_events, 0);
    if (dropped_total && esp_timer_get_time() - last_report >= 1000000) { ESP_LOGW("CLEX", "Timer events dropped: %u", dropped_total); dropped_total = 0; last_report = esp_timer_get_time(); }
    if (available) vTaskDelay(1);
  }
}
void app_main(void) {
${buses.initialize}
${graphics.initialize}
${initializers.join('\n')}
${stepper.initialize}
${temperature.initialize}
${gpioEdge.initialize?'\n'+gpioEdge.initialize:''}
${stopwatch.initialize ? stopwatch.initialize+'\n' : ''}  timer_queue = xQueueCreate(128, sizeof(${events?'clex_flow_event_t':'uint16_t'}));
  if (!timer_queue || xTaskCreate(flow_worker, "clex_flow", 8192, NULL, 5, NULL) != pdPASS) { ESP_LOGE("CLEX", "Cannot create worker"); abort(); }
${media.initialize}
${network.initialize}
${network.start}
${router.start}
${espnow.initialize?'\n'+espnow.initialize:''}
${mqtt.initialize}
${timers.map(({node,i})=>`  static const uint16_t timer_node_${i} = ${i};
  esp_timer_handle_t timer_${i};
  esp_timer_create_args_t args_${i} = { .callback = timer_callback, .arg = (void *)&timer_node_${i}, .dispatch_method = ESP_TIMER_TASK, .name = "clex_${i}", .skip_unhandled_events = true };
  ESP_ERROR_CHECK(esp_timer_create(&args_${i}, &timer_${i}));
  ESP_ERROR_CHECK(esp_timer_start_periodic(timer_${i}, ${node.parameters.intervalMs}ULL * 1000ULL));`).join('\n')}
${mqtt.enabled?'  atomic_store(&clex_flow_ready, true);\n':''}  ESP_LOGI("CLEX", "Flow ready: ${nodes.length} blocks, ${timers.length} timers");
}
`;
  if (new TextEncoder().encode(source).length > 2 * 1024 * 1024) throw new Error('Исходники прошивки превышают 2 МБ. Уменьшите изображения.');
  const flashSize = board.firmware.flashSizeMb;
  const config = `CONFIG_IDF_TARGET="${board.target}"\nCONFIG_ESPTOOLPY_FLASHSIZE_${flashSize}MB=y\nCONFIG_ESPTOOLPY_FLASHMODE_DIO=y\nCONFIG_FREERTOS_HZ=1000\nCONFIG_LOG_COLORS=n\nCONFIG_ESP_CONSOLE_${consoleMode==='usb'?'USB_SERIAL_JTAG':'UART_DEFAULT'}=y\nCONFIG_ESP_CONSOLE_SECONDARY_NONE=y\n`;
  const graphicsFiles = graphics.runtime ? { ...GRAPHICS_FILES, 'main/idf_component.yml': 'dependencies:\n  lvgl/lvgl: "=9.2.2"\n' } : {};
  const requirements='esp_driver_gpio esp_timer freertos log' + (graphics.runtime?' esp_lcd esp_driver_spi lvgl__lvgl':'') + (network.runtime?' esp_driver_spi '+NETWORK_DEPENDENCIES:'');
  const dependencyList=[...new Set([...requirements.split(' '),...extraProfiles.flatMap(profile=>profile.requires)])].join(' ');
  const managed=Object.assign({},...(graphics.runtime?[{'lvgl/lvgl':'9.2.2'}]:[]),...extraProfiles.map(profile=>Object.fromEntries(Object.entries(profile.dependencies).sort(([a],[b])=>a.localeCompare(b)))));
  const manifest=Object.keys(managed).length?{'main/idf_component.yml':'dependencies:\n'+Object.entries(managed).map(([name,version])=>'  '+name+': "='+version+'"\n').join('')}:{};
  return { networkRuntime:network.runtime, graphicsRuntime: graphics.runtime, boardId: board.id, target: board.target, boardRevision, featureRuntimes, consoleMode, mainC: source, warnings: issues.filter(issue=>issue.severity==='warning'), files: {
    ...graphicsFiles, ...manifest, ...componentFiles,
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16)\nset(COMPONENTS main)\n'+extraProfiles.map(p=>p.cmakePrelude||'').join('')+'include($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(clex_flow_firmware)\n',
    'main/CMakeLists.txt': 'idf_component_register(SRCS "main.c"' + (graphics.runtime?' '+GRAPHICS_SOURCES:'') + ' INCLUDE_DIRS "." REQUIRES '+dependencyList+')\n',
    ...((router.enabled||network.partitions||espnow.enabled)?{'partitions.csv':router.enabled?router.partitions:network.partitions||'nvs,data,nvs,0x9000,0x6000\nphy_init,data,phy,0xf000,0x1000\nfactory,app,factory,0x10000,0x300000\n'}:{}),
    'main/main.c': source, 'sdkconfig.defaults': config + (boardRevision ? board.firmware.revisionConfigs[boardRevision] : '') + (graphics.runtime ? GRAPHICS_CONFIG : '') + network.config + extraConfig + (router.boardConfig||''),
  } };
}
export async function firmwareFingerprint(bundle) {
  const identity=[bundle.boardId,bundle.consoleMode,bundle.mainC];if(bundle.graphicsRuntime)identity.push(bundle.graphicsRuntime);if(bundle.networkRuntime)identity.push(bundle.networkRuntime);if(bundle.boardRevision)identity.push(bundle.boardRevision);if(bundle.featureRuntimes?.length)identity.push(bundle.featureRuntimes);
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
