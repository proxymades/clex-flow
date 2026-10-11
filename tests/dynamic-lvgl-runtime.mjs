// Runs generated counter/display code against real LVGL 9.2.2 already cached locally.
// No SDK installation, hardware substitution or GitHub publication is performed.
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dynamicDisplayProject } from './dynamic-display-fixture.js';
import { catalog, timer } from './catalog-fixture.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
import { elementUpdatePort } from '../src/displays/model.js';
import { generateFirmware, cString } from '../src/firmware/generator.js';
const lvgl = resolve(process.env.CLEX_TEST_LVGL_PATH || '.artifacts/display-real-build/managed_components/lvgl__lvgl');
const host = resolve(process.env.CLEX_TEST_LVGL_HOST || '.artifacts/lvgl-host');
const library = join(host, 'lib/liblvgl.a'), config = join(host, 'lv_conf.h');
if (!existsSync(library) || !existsSync(config)) throw new Error('Prepare the local LVGL host library first; see docs/displays.md.');
const output = resolve('.artifacts/dynamic-lvgl-runtime'); mkdirSync(output, { recursive: true });
for (const { step, multi } of [{step:1,multi:false}, {step:-1,multi:false}, {step:1,multi:true}]) {
  let project = dynamicDisplayProject();
  const originalTimerId = project.logic.nodes.find(node => node.moduleId === timer.id).id;
  const counter = project.logic.nodes.find(node => node.moduleId === 'clex.logic.counter'); counter.parameters.step = step;
  let secondTimerId = null;
  if (multi) {
    const screen = project.screens[project.components[0].id], first = screen.elements[1];
    const second = {...first, id: randomUUID(), name:'Второй счётчик', prefix:'Второй: ', y:140}; screen.elements.push(second);
    let graph = project.logic;
    graph.edges = graph.edges.map(edge => edge.targetHandle === 'trigger' ? {...edge, targetHandle: elementUpdatePort(first.id)} : edge);
    graph = addNode(graph, timer); const secondTimer = graph.nodes.at(-1); secondTimer.parameters.intervalMs = 2000; secondTimerId = secondTimer.id;
    graph = addNode(graph, catalog.modules.find(module => module.id === 'clex.logic.counter')); const secondCounter = graph.nodes.at(-1); secondCounter.parameters.step = 10;
    const view = graph.nodes.find(node => node.moduleId === 'clex.logic.display');
    for (const connection of [
      {source:secondTimer.id,sourceHandle:'tick',target:secondCounter.id,targetHandle:'increment'},
      {source:secondCounter.id,sourceHandle:'done',target:view.id,targetHandle:elementUpdatePort(second.id)},
      {source:secondCounter.id,sourceHandle:'value',target:view.id,targetHandle:second.id},
    ]) graph = connectNodes(graph, catalog, connection, project);
    project = withLogic(project, graph);
  }
  const sorted = [...project.logic.nodes].sort((a, b) => a.id < b.id ? -1 : 1);
  const secondTimerIndex = sorted.findIndex(node => node.id === secondTimerId);
  const counterIndex = sorted.findIndex(node => node.id === counter.id);
  const timerIndex = sorted.findIndex(node => node.id === originalTimerId);
  const bundle = generateFirmware(project, catalog), source = bundle.mainC;
  const setter = source.slice(source.indexOf('/* Objects are initialized'), source.indexOf('static uint32_t clex_graphics_tick'));
  const initial = source.slice(source.indexOf('  lv_obj_t *screen = lv_screen_active();'), source.indexOf('\n}\nstatic QueueHandle_t timer_queue;'));
  const functions = source.slice(source.indexOf('static void node_0(void) {'), source.indexOf('static void __attribute__((unused)) timer_callback'));
  const declarations = [...source.matchAll(/^static int32_t value_\d+ = .*;$/gm)].map(match => match[0]).join('\n');
  const prototypes = [...source.matchAll(/^static void node_\d+(?:_reset|_element_\d+)?\(void\) __attribute__\(\(unused\)\);$/gm)].map(match => match[0]).join('\n');
  const fonts = [...source.matchAll(/^LV_FONT_DECLARE\([^\n]+$/gm)].map(match => match[0]).join('\n');
  const fontFiles = Object.entries(bundle.files).filter(([name]) => name.startsWith('main/clex_font_')).map(([name, content]) => { const path = join(output, name.slice(5)); writeFileSync(path, content); return path; });
  const c = `#include <assert.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "lvgl.h"
${fonts}
${setter}
${declarations}
${prototypes}
${functions}
static uint8_t draw_buffer[240 * 20 * 2], pixels[240 * 320 * 2];
static unsigned rendered_pixels;
static void capture(lv_display_t *display, const lv_area_t *area, uint8_t *data) {
  unsigned width = area->x2 - area->x1 + 1;
  for (int y = area->y1; y <= area->y2; y++) memcpy(pixels + (y * 240 + area->x1) * 2, data + (y - area->y1) * width * 2, width * 2);
  rendered_pixels += width * (area->y2 - area->y1 + 1);
  lv_display_flush_ready(display);
}
static uint32_t image_hash(void) { uint32_t hash = 2166136261u; for (unsigned i = 0; i < sizeof(pixels); i++) hash = (hash ^ pixels[i]) * 16777619u; return hash; }
static void refresh(void) { lv_tick_inc(40); lv_timer_handler(); }
int main(void) {
  lv_init();
  lv_display_t *display = lv_display_create(240, 320); assert(display);
  lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
  lv_display_set_buffers(display, draw_buffer, NULL, sizeof(draw_buffer), LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(display, capture);
${initial}
  refresh();
  for (int i = 1; i <= 3; i++) {
    uint32_t before = image_hash(); rendered_pixels = 0;
    node_${timerIndex}(); refresh();
    char expected[64]; snprintf(expected, sizeof(expected), "%s%d", ${cString('Счётчик: ')}, i * ${step});
    assert(strcmp(lv_label_get_text(clex_text_elements[0].object), expected) == 0);
    assert(strcmp(lv_label_get_text(text_0), ${cString('Привет, мир! CLEX Flow')}) == 0);
    assert(before != image_hash()); assert(rendered_pixels > 0 && rendered_pixels < 240 * 320);
    ${multi ? `assert(strcmp(lv_label_get_text(clex_text_elements[1].object), ${cString('Второй: 0')}) == 0);` : ''}
    printf("LVGL rendered: %s (%u pixels)\\n", expected, rendered_pixels);
  }
  ${multi ? `node_${secondTimerIndex}(); refresh(); assert(strcmp(lv_label_get_text(clex_text_elements[1].object), ${cString('Второй: 10')}) == 0); assert(strcmp(lv_label_get_text(clex_text_elements[0].object), ${cString('Счётчик: 3')}) == 0); puts("PASS: two independent sources update two elements of one display.");` : ''}
  node_${counterIndex}_reset(); refresh(); assert(value_${counterIndex} == 0);
  assert(strcmp(lv_label_get_text(clex_text_elements[0].object), ${cString('Счётчик: 0')}) == 0);
  value_${counterIndex} = ${step > 0 ? 'INT32_MAX - 1' : 'INT32_MIN + 1'};
  node_${timerIndex}(); refresh(); assert(value_${counterIndex} == ${step > 0 ? 'INT32_MAX' : 'INT32_MIN'});
  rendered_pixels = 0; node_${timerIndex}(); refresh();
  assert(value_${counterIndex} == ${step > 0 ? 'INT32_MAX' : 'INT32_MIN'}); assert(rendered_pixels == 0);
  lv_font_glyph_dsc_t glyph;
  assert(lv_font_get_glyph_dsc(&clex_font_montserrat_20, &glyph, 0x421, 0));
  assert(lv_font_get_glyph_dsc(&clex_font_montserrat_20, &glyph, 0x451, 0));
  assert(lv_font_get_glyph_dsc(&clex_font_montserrat_20, &glyph, 0xB0, 0));
  lv_display_delete(display); lv_deinit();
  puts("PASS: generated event dispatch, counter/reset/overflow, Cyrillic/degree fonts, real LVGL label updates and partial rendering; unchanged values do not redraw.");
}
`;
  const sourcePath = join(output, `runtime-${multi ? 'multi' : step}.c`), binary = join(output, `runtime-${multi ? 'multi' : step}`); writeFileSync(sourcePath, c);
  const compile = spawnSync(process.env.CLEX_TEST_CC || 'clang', ['-std=c11', '-fsanitize=undefined', '-fno-sanitize-recover=undefined', '-I', lvgl, '-DLV_CONF_PATH=' + config, sourcePath, ...fontFiles, library, '-lm', '-o', binary], { encoding: 'utf8' });
  if (compile.status !== 0) throw new Error(compile.stderr || 'Host compilation failed');
  const run = spawnSync(binary, [], { encoding: 'utf8' }); process.stdout.write(run.stdout);
  if (run.status !== 0) throw new Error(run.stderr || 'LVGL runtime check failed');
}
