import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from './catalog-fixture.js';
import { displayProject, displayModule } from './display-fixture.js';
import { generateFirmware, firmwareFingerprint, cString } from '../src/firmware/generator.js';
import { serializeProject, parseProject } from '../src/projects/model.js';
import { removeHardware, connectionProblem, addHardware } from '../src/assembly/model.js';
import { screenIssues } from '../src/displays/model.js';

test('display-only firmware uses actual SPI assignments, ESP LCD and pinned LVGL without timer nodes',()=>{
 const project=displayProject(),bundle=generateFirmware(project,catalog);
 assert.equal(bundle.graphicsRuntime,'lvgl-9.2.2');
 assert.match(bundle.mainC,/sclk_io_num = 16, .mosi_io_num = 17/);
 assert.match(bundle.mainC,/dc_gpio_num = 15, .cs_gpio_num = 18/);
 assert.match(bundle.mainC,/reset_gpio_num = 38/);
 assert.match(bundle.mainC,/esp_lcd_new_panel_st7789/);
 assert.ok(bundle.mainC.includes('lv_label_set_text(text_0, '+cString('Привет, мир! CLEX Flow')+');'));
 for(const char of 'ПриветмирЁё') assert.match(bundle.files['main/clex_font_montserrat_14.c'],new RegExp('U\\+'+char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')));
 assert.match(bundle.files['main/clex_font_montserrat_14.c'],/U\+041F/);
 assert.match(bundle.mainC,/clex_font_montserrat_14/);
 assert.match(bundle.mainC,/lv_color_hex\(0x123456\)/);
 assert.match(bundle.files['main/idf_component.yml'],/lvgl\/lvgl: "=9.2.2"/);
 assert.match(bundle.files['main/CMakeLists.txt'],/lvgl__lvgl/);
 assert.doesNotMatch(bundle.mainC,/backlight|BL_GPIO/);
});
test('screens persist once per hardware instance, invalid owners are rejected and removal cleans them up',()=>{
 const project=displayProject(),id=project.components[0].id;
 assert.deepEqual(parseProject(serializeProject(project)).screens,project.screens);
 assert.equal(removeHardware(project,catalog,id).screens[id],undefined);
 const bad=structuredClone(project);bad.screens.missing=bad.screens[id];
 assert.throws(()=>serializeProject(bad));
 assert.match(connectionProblem(project,catalog,id,'vcc','P1'),/питан|напряж/i);
});
test('unsupported font glyphs, outside coordinates and unsupported drivers stop generation',()=>{
 const project=displayProject(),screen=project.screens[project.components[0].id];
 screen.elements[0].text='🌍';
 assert.ok(screenIssues(screen,displayModule.display).length>0);
 assert.throws(()=>generateFirmware(project,catalog),/шрифт/);
 screen.elements[0].text='CLEX Flow';screen.elements[0].x=240;
 assert.throws(()=>generateFirmware(project,catalog),/Координат/);
 screen.elements[0].x=20;
 const bad=structuredClone(catalog);bad.modules.find(module=>module.id===displayModule.id).display.driverKey='unimplemented';
 assert.throws(()=>generateFirmware(project,bad),/драйвер/);
});
test('another module configuration reuses the driver; screen content invalidates build while editor position does not',async()=>{
 const project=displayProject(),bundle=generateFirmware(project,catalog);
 const variant=structuredClone(catalog);const module=variant.modules.find(module=>module.id===displayModule.id);
 module.id='example.display.spi-square';module.display.resolution.height=240;module.display.initialization.yGap=80;
 const variantProject=structuredClone(project);variantProject.components[0].moduleId=module.id;delete variantProject.moduleVersions[displayModule.id];variantProject.moduleVersions[module.id]=module.version;
 const next=generateFirmware(variantProject,variant);
 assert.match(next.mainC,/lv_display_create\(240, 240\)/);
 assert.match(next.mainC,/esp_lcd_panel_set_gap\(clex_panel, 0, 80\)/);
 project.assembly.positions[project.components[0].id]={x:900,y:400};
 assert.equal(await firmwareFingerprint(generateFirmware(project,catalog)),await firmwareFingerprint(bundle));
 project.screens[project.components[0].id].background='#000000';
 assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog)),await firmwareFingerprint(bundle));
});

test('new hardware does not overlap a taller display card',()=>{
 let project=displayProject();
 const button=catalog.modules.find(module=>module.id==='clex.hardware.button');
 project=addHardware(project,button,catalog);
 const first=project.assembly.positions[project.components[0].id],second=project.assembly.positions[project.components[1].id];
 assert.ok(second.x>=first.x+displayModule.visual.width || second.y>=first.y+displayModule.visual.height);
});
