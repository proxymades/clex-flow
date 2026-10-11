import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import {displayProject} from './display-fixture.js';
import {catalog} from './catalog-fixture.js';
import {newIndicator} from '../src/displays/indicator.js';
import {generateFirmware,cString} from '../src/firmware/generator.js';
const project=displayProject(),component=project.components[0],screen=project.screens[component.id],display=catalog.modules.find(module=>module.display).display;
const first=newIndicator(display);first.y=80;first.states[0].text='Ожидание';first.states[1].text='Готово';first.states[1].background='#005544';first.states[1].dotColor='#11ff22';
const second=newIndicator(display);second.y=170;second.dotVisible=false;second.dotPosition='bottom';second.align='right';second.states[1].text='Другой';
screen.elements.push(first,second);
const bundle=generateFirmware(project,catalog),source=bundle.mainC,output=resolve('.artifacts/indicator-runtime');mkdirSync(output,{recursive:true});
const declarations=source.slice(source.indexOf('/* CLEX indicators'),source.indexOf('static uint32_t clex_graphics_tick'));
const fonts=[...source.matchAll(/^LV_FONT_DECLARE\([^\n]+$/gm)].map(match=>match[0]).join('\n');
const initialize=source.slice(source.indexOf('  lv_obj_t *screen = lv_screen_active();'),source.indexOf('\n}\nstatic QueueHandle_t timer_queue;'));
const files=Object.entries(bundle.files).filter(([name])=>name.startsWith('main/clex_font_')).map(([name,text])=>{const path=join(output,name.slice(5));writeFileSync(path,text);return path;});
const c=`#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include "lvgl.h"
${fonts}
${declarations}
static uint8_t buffer[240*20*2], image[240*320*2]; static unsigned rendered;
static void capture(lv_display_t *display,const lv_area_t *area,uint8_t *pixels){unsigned width=area->x2-area->x1+1;for(int y=area->y1;y<=area->y2;y++)memcpy(image+(y*240+area->x1)*2,pixels+(y-area->y1)*width*2,width*2);rendered+=width*(area->y2-area->y1+1);lv_display_flush_ready(display);}
static void refresh(void){lv_tick_inc(40);lv_timer_handler();}
int main(void){lv_init();lv_display_t *display=lv_display_create(240,320);lv_display_set_color_format(display,LV_COLOR_FORMAT_RGB565);lv_display_set_buffers(display,buffer,NULL,sizeof(buffer),LV_DISPLAY_RENDER_MODE_PARTIAL);lv_display_set_flush_cb(display,capture);
${initialize}
refresh();lv_obj_t *original=clex_indicators[0].object;rendered=0;
clex_graphics_set_indicator_state(${cString(component.id)},${cString(first.id)},"1");refresh();
assert(strcmp(lv_label_get_text(clex_indicators[0].label),${cString('Готово')})==0);assert(lv_color_eq(lv_obj_get_style_bg_color(original,LV_PART_MAIN),lv_color_hex(0x005544)));assert(lv_color_eq(lv_obj_get_style_bg_color(clex_indicators[0].dot,LV_PART_MAIN),lv_color_hex(0x11ff22)));assert(rendered>0&&rendered<240*320);
rendered=0;clex_graphics_set_indicator_state(${cString(component.id)},${cString(first.id)},"1");refresh();assert(rendered==0);
clex_graphics_set_indicator_caption(${cString(component.id)},${cString(first.id)},${cString('Своя надпись')});clex_graphics_set_indicator_state(${cString(component.id)},${cString(first.id)},"0");refresh();assert(strcmp(lv_label_get_text(clex_indicators[0].label),${cString('Своя надпись')})==0);assert(original==clex_indicators[0].object);
clex_graphics_set_indicator_state(${cString(component.id)},${cString(second.id)},"1");refresh();assert(!clex_indicators[1].dot);assert(strcmp(lv_label_get_text(clex_indicators[1].label),${cString('Другой')})==0);assert(strcmp(lv_label_get_text(clex_indicators[0].label),${cString('Своя надпись')})==0);
assert(strcmp(lv_label_get_text(text_0),${cString('Привет, мир! CLEX Flow')})==0);lv_display_delete(display);lv_deinit();puts("PASS: real LVGL indicator text/background/dot updates, independent objects, Cyrillic captions, hidden dot, caption override, partial drawing and unchanged-state suppression.");}
`;
const path=join(output,'indicator.c'),binary=join(output,'indicator');writeFileSync(path,c);
const root=resolve(process.env.CLEX_TEST_LVGL_PATH||'.artifacts/display-real-build/managed_components/lvgl__lvgl'),host=resolve('.artifacts/lvgl-host');
const compiled=spawnSync('clang',['-std=c11','-fsanitize=undefined','-fno-sanitize-recover=undefined','-I',root,'-DLV_CONF_PATH='+join(host,'lv_conf.h'),path,...files,join(host,'lib/liblvgl.a'),'-lm','-o',binary],{encoding:'utf8'});if(compiled.status!==0)throw new Error(compiled.stderr);
const result=spawnSync(binary,[],{encoding:'utf8'});process.stdout.write(result.stdout);if(result.status!==0)throw new Error(result.stderr);
