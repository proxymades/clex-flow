import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from './catalog-fixture.js';
import { displayProject, displayModule } from './display-fixture.js';
import { p4Project } from './p4-fixture.js';
import { encodePixels, imageIssues, resizeImage, renderedImage } from '../src/displays/image.js';
import { screenIssues, screenPorts, saveScreen } from '../src/displays/model.js';
import { serializeProject, parseProject } from '../src/projects/model.js';
import { generateFirmware, firmwareFingerprint } from '../src/firmware/generator.js';

const pixels = new Uint8ClampedArray([255,0,0,255, 0,255,0,128, 0,0,255,0, 255,255,255,255]);
export function logo() { return { id: 'test-logo', type: 'image', name: 'Логотип', x: 12, y: 90, width: 2, height: 2, image: { format: 'rgba8888', width: 2, height: 2, data: encodePixels(pixels) } }; }
test('PNG pixel conversion preserves separate RGB565 and alpha planes', () => {
  const rendered = renderedImage(logo());
  assert.deepEqual([...rendered.rgb565a8], [0,248, 224,7, 0,0, 255,255, 255,128,0,255]);
  assert.deepEqual([...rendered.rgba], [255,0,0,255, 0,255,0,128, 0,0,0,0, 255,255,255,255]);
  const edge = { ...logo(), width: 3, height: 1, image: { format: 'rgba8888', width: 2, height: 1, data: encodePixels(new Uint8ClampedArray([255,0,0,255,0,0,255,0])) } };
  assert.deepEqual([...renderedImage(edge).rgba.slice(4,8)], [255,0,0,128], 'transparent neighbor does not introduce a blue/dark halo');
});
test('image resizing keeps source proportions and stays inside the display', () => {
  const image = { ...logo(), image: { ...logo().image, width: 2, height: 1 }, x: 200, y: 300 };
  assert.deepEqual(resizeImage(image, 'width', 200, { width: 240, height: 320 }), { width: 40, height: 20 });
  assert.deepEqual(resizeImage(image, 'height', 0, { width: 240, height: 320 }), { width: 1, height: 1 });
});
test('images round-trip with the project, have no data ports and support a single timed splash', () => {
  const project = displayProject(), id = project.components[0].id, image = { ...logo(), splash: true, durationMs: 2300 };
  project.screens[id].elements.push(image);
  assert.deepEqual(parseProject(serializeProject(project)).screens, project.screens);
  assert.deepEqual(screenPorts({ elements: [image] }), []);
  assert.deepEqual(screenIssues(project.screens[id], displayModule.display), []);
  assert.deepEqual(saveScreen(project,id,project.screens[id]).screens[id].elements.at(-1), image);
  const bad = structuredClone(project); bad.screens[id].elements.push({ ...image, id: 'second-logo' });
  assert.throws(() => serializeProject(bad), /одна заставка/);
  image.durationMs = 0;
  assert.throws(() => serializeProject(project), /Время заставки/);
});
test('malformed pixels and images outside the display are rejected before generation', () => {
  for (const data of ['', 'AAAA', '!!!!!!!!!!!!!!!!!!!!!!!!']) assert.ok(imageIssues({ ...logo(), image: { ...logo().image, data } }).length);
  const image = logo(); image.width = 100000;
  assert.ok(imageIssues(image).length);
  const project = displayProject(), id = project.components[0].id;
  project.screens[id].elements.push({ ...logo(), x: 239 });
  assert.throws(() => generateFirmware(project,catalog), /границ/);
});
test('S3/P4 firmware embeds static pixels and switches from splash to live content with a one-shot LVGL timer', async () => {
  for (const project of [displayProject(),p4Project(false)]) {
    const id = project.components[0].id, image = { ...logo(), splash: true, durationMs: 2300 };
    project.screens[id].elements.push(image);
    const bundle = generateFirmware(project,catalog,project.boardId.includes('p4') ? 'uart' : 'usb');
    assert.match(bundle.mainC,/LV_COLOR_FORMAT_RGB565A8/);
    assert.match(bundle.mainC,/\.magic = LV_IMAGE_HEADER_MAGIC/);
    assert.match(bundle.mainC,/clex_splash = lv_image_create\(root_screen\)/);
    assert.match(bundle.mainC,/lv_obj_add_flag\(clex_main_content, LV_OBJ_FLAG_HIDDEN\)/);
    assert.match(bundle.mainC,/lv_timer_create\(clex_graphics_finish_splash, 2300, NULL\)/);
    assert.match(bundle.mainC,/lv_timer_set_repeat_count\(splash_timer, 1\)/);
    assert.match(bundle.mainC,/lv_obj_delete\(clex_splash\)/);
    const before = await firmwareFingerprint(bundle);
    image.durationMs = 3100;
    assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog,bundle.consoleMode)),before);
    const timed = await firmwareFingerprint(generateFirmware(project,catalog,bundle.consoleMode));
    image.image.data = encodePixels(new Uint8ClampedArray(pixels).fill(255));
    assert.notEqual(await firmwareFingerprint(generateFirmware(project,catalog,bundle.consoleMode)),timed);
    image.splash = false;
    const permanent = generateFirmware(project,catalog,bundle.consoleMode);
    assert.doesNotMatch(permanent.mainC,/clex_splash|splash_timer/);
    assert.match(permanent.mainC,/lv_image_create\(screen\)/);
  }
});
