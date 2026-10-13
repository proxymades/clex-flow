import { renderedImage } from '../../displays/image.js';

export function imageFirmware(screen) {
  const images = screen.elements.map((element, index) => ({ element, index })).filter(({ element }) => element.type === 'image');
  const splash = images.find(({ element }) => element.splash);
  const source = images.flatMap(({ element, index }) => {
    const { rgb565a8 } = renderedImage(element), lines = [];
    for (let i = 0; i < rgb565a8.length; i += 16) lines.push('  ' + Array.from(rgb565a8.subarray(i, i + 16), byte => '0x' + byte.toString(16).padStart(2, '0')).join(', ') + ',');
    return [
      'static const uint8_t clex_image_data_' + index + '[] __attribute__((aligned(4))) = {',
      ...lines, '};',
      'static const lv_image_dsc_t clex_image_' + index + ' = {',
      '  .header = { .magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_RGB565A8, .flags = 0, .w = ' + element.width + ', .h = ' + element.height + ', .stride = ' + element.width * 2 + ' },',
      '  .data_size = sizeof(clex_image_data_' + index + '), .data = clex_image_data_' + index + ',',
      '};',
    ];
  });
  if (splash) source.push(
    'static lv_obj_t *clex_main_content, *clex_splash;',
    'static void clex_graphics_finish_splash(lv_timer_t *timer) {',
    '  (void)timer; lv_obj_delete(clex_splash); clex_splash = NULL;',
    '  lv_obj_remove_flag(clex_main_content, LV_OBJ_FLAG_HIDDEN);',
    '}',
  );
  const prepare = splash ? [
    '  lv_obj_t *root_screen = screen;',
    '  clex_main_content = lv_obj_create(root_screen);',
    '  lv_obj_set_pos(clex_main_content, 0, 0);',
    '  lv_obj_set_size(clex_main_content, ' + screen.width + ', ' + screen.height + ');',
    '  lv_obj_set_style_bg_opa(clex_main_content, LV_OPA_TRANSP, LV_PART_MAIN);',
    '  lv_obj_set_style_radius(clex_main_content, 0, LV_PART_MAIN);',
    '  lv_obj_set_style_border_width(clex_main_content, 0, LV_PART_MAIN);',
    '  lv_obj_set_style_pad_all(clex_main_content, 0, LV_PART_MAIN);',
    '  lv_obj_remove_flag(clex_main_content, LV_OBJ_FLAG_SCROLLABLE);',
    '  lv_obj_add_flag(clex_main_content, LV_OBJ_FLAG_HIDDEN);',
    '  screen = clex_main_content;',
  ] : [];
  return {
    source, prepare,
    initialize(element, index) {
      const name = element.splash ? 'clex_splash' : 'image_' + index;
      return [
        '  ' + (element.splash ? '' : 'lv_obj_t *') + name + ' = lv_image_create(' + (element.splash ? 'root_screen' : 'screen') + ');',
        '  lv_image_set_src(' + name + ', &clex_image_' + index + ');',
        '  lv_obj_set_pos(' + name + ', ' + element.x + ', ' + element.y + ');',
        '  lv_obj_remove_flag(' + name + ', LV_OBJ_FLAG_CLICKABLE);',
      ];
    },
    start: splash ? [
      '  lv_timer_t *splash_timer = lv_timer_create(clex_graphics_finish_splash, ' + splash.element.durationMs + ', NULL);',
      '  if (!splash_timer) { ESP_LOGE("CLEX", "Cannot create splash timer"); abort(); }',
      '  lv_timer_set_repeat_count(splash_timer, 1);',
    ] : [],
  };
}
