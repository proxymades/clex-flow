// Exercises generated image descriptors and the splash timer against cached real LVGL 9.2.2.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { dynamicDisplayProject } from './dynamic-display-fixture.js';
import { catalog } from './catalog-fixture.js';
import { encodePixels } from '../src/displays/image.js';
import { generateFirmware, cString } from '../src/firmware/generator.js';
const lvgl = resolve(process.env.CLEX_TEST_LVGL_PATH || '.artifacts/display-real-build/managed_components/lvgl__lvgl');
const host = resolve(process.env.CLEX_TEST_LVGL_HOST || '.artifacts/lvgl-host');
const library = join(host, 'lib/liblvgl.a'), config = join(host, 'lv_conf.h');
if (!existsSync(library)) throw new Error('Prepare the local LVGL host library first; see docs/displays.md.');
const output = resolve('.artifacts/image-lvgl-runtime'); mkdirSync(output, { recursive: true });
const project = dynamicDisplayProject(), componentId = project.components[0].id, screen = project.screens[componentId];
screen.background = '#0000ff';
const image = {id:'logo',type:'image',x:80,y:180,width:2,height:2,splash:true,durationMs:1500,image:{format:'rgba8888',width:2,height:2,data:encodePixels(new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,0,255,255,255,255]))}};
screen.elements.push(image, {...image,id:'permanent',x:100,splash:false});
const bundle = generateFirmware(project,catalog), source = bundle.mainC;
const declarations = source.slice(source.indexOf('static const uint8_t clex_image_data_'),source.indexOf('static uint32_t clex_graphics_tick'));
const initial = source.slice(source.indexOf('  lv_obj_t *screen = lv_screen_active();'),source.indexOf('\n}\nstatic QueueHandle_t timer_queue;'));
const fonts = [...source.matchAll(/^LV_FONT_DECLARE\([^\n]+$/gm)].map(match=>match[0]).join('\n');
const fontFiles = Object.entries(bundle.files).filter(([name])=>name.startsWith('main/clex_font_')).map(([name,content])=>{const path=join(output,name.slice(5));writeFileSync(path,content);return path;});
const c = `#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include "lvgl.h"
#define ESP_LOGE(...) ((void)0)
${fonts}
${declarations}
static uint8_t draw_buffer[240*20*2], pixels[240*320*2];
static void capture(lv_display_t *display,const lv_area_t *area,uint8_t *data) {
  unsigned width=area->x2-area->x1+1;
  for(int y=area->y1;y<=area->y2;y++)memcpy(pixels+(y*240+area->x1)*2,data+(y-area->y1)*width*2,width*2);
  lv_display_flush_ready(display);
}
static uint16_t pixel(int x,int y) { unsigned i=(y*240+x)*2;return pixels[i]|(pixels[i+1]<<8); }
static void refresh(uint32_t time) { lv_tick_inc(time);lv_timer_handler(); }
int main(void) {
  lv_init();lv_display_t *display=lv_display_create(240,320);assert(display);
  lv_display_set_color_format(display,LV_COLOR_FORMAT_RGB565);
  lv_display_set_buffers(display,draw_buffer,NULL,sizeof(draw_buffer),LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(display,capture);
${initial}
  assert(lv_obj_has_flag(clex_main_content,LV_OBJ_FLAG_HIDDEN));assert(clex_splash);
  refresh(10);
  assert(pixel(80,180)==0xf800);
  assert(pixel(80,181)==0x001f);
  assert(pixel(81,181)==0xffff);
  uint16_t blended=pixel(81,180);
  assert((blended&0x07e0)!=0 && (blended&0x001f)!=0 && (blended&0xf800)==0);
  assert(pixel(100,180)==0x001f);
  clex_graphics_set_text(${cString(componentId)},${cString(screen.elements[1].id)},"42");
  assert(strcmp(lv_label_get_text(clex_text_elements[0].object),${cString('Счётчик: 42')})==0);
  refresh(1480);assert(clex_splash);assert(lv_obj_has_flag(clex_main_content,LV_OBJ_FLAG_HIDDEN));
  refresh(20);refresh(40);
  assert(clex_splash==NULL);assert(!lv_obj_has_flag(clex_main_content,LV_OBJ_FLAG_HIDDEN));
  assert(pixel(80,180)==0x001f);assert(pixel(100,180)==0xf800);
  assert(strcmp(lv_label_get_text(clex_text_elements[0].object),${cString('Счётчик: 42')})==0);
  refresh(2000);assert(clex_splash==NULL);
  lv_display_delete(display);lv_deinit();
  puts("PASS: real LVGL RGB565 colors, transparent/semitransparent pixels, hidden main content, live value updates during splash, timed reveal and persistent main-screen image.");
}
`;
const sourcePath=join(output,'runtime.c'),binary=join(output,'runtime');writeFileSync(sourcePath,c);
const compile=spawnSync(process.env.CLEX_TEST_CC||'clang',['-std=c11','-fsanitize=undefined','-fno-sanitize-recover=undefined','-I',lvgl,'-DLV_CONF_PATH='+config,sourcePath,...fontFiles,library,'-lm','-o',binary],{encoding:'utf8'});
if(compile.status!==0)throw new Error(compile.stderr||'Host compilation failed');
const run=spawnSync(binary,[],{encoding:'utf8'});process.stdout.write(run.stdout);
if(run.status!==0)throw new Error(run.stderr||'LVGL image runtime check failed');
