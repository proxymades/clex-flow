import fonts from '../../displays/fonts/lvgl-fonts.json' with { type: 'json' };
import { st7789Spi } from './esp-idf/st7789-spi.js';
import { displayDescription, screenFor, screenIssues } from '../../displays/model.js';

export const GRAPHICS_RUNTIME = 'lvgl-9.2.2';
export const GRAPHICS_CONFIG = 'CONFIG_LV_COLOR_DEPTH_16=y\nCONFIG_LV_FONT_MONTSERRAT_14=y\nCONFIG_LV_FONT_MONTSERRAT_20=y\nCONFIG_LV_FONT_MONTSERRAT_28=y\n';
const fontSymbols = Object.fromEntries(Object.entries(fonts).map(([id, font]) => [id, font.symbol]));
export const GRAPHICS_FILES = Object.fromEntries(Object.values(fonts).map(font => ['main/' + font.symbol + '.c', font.source]));
export const GRAPHICS_SOURCES = Object.values(fonts).map(font => '"' + font.symbol + '.c"').join(' ');
const driverRegistry = { 'esp-idf': { 'st7789-spi': st7789Spi } };
export function supportsDisplayDriver(display, platform) {
  return Boolean(display?.supportedPlatforms.includes(platform) && driverRegistry[platform]?.[display.driverKey]);
}
const color = hex => '0x' + hex.slice(1);

export function displayFirmware(project, catalog, cString) {
  const ids = [...new Set(project.logic.nodes.filter(node => catalog.modules.find(module => module.id === node.moduleId)?.editor === 'screen').map(node => node.parameters.componentId))];
  if (!ids.length) return { runtime: null, source: '', initialize: '', update: '' };
  if (ids.length > 1) throw new Error('Первая реализация аппаратного драйвера поддерживает один активный дисплей. Редактор хранит интерфейсы отдельно для каждого устройства.');
  const component = project.components.find(component => component.id === ids[0]), display = displayDescription(component, catalog);
  const platform = catalog.boards.find(board => board.id === project.boardId)?.platform;
  if (!supportsDisplayDriver(display, platform)) throw new Error('Для этого дисплея нет реализованного драйвера ESP-IDF.');
  const screen = screenFor(project, component.id), errors = screenIssues(screen, display);
  if (errors.length) throw new Error(errors.join('\n'));
  const { width, height } = display.resolution;
  const source = [
    driverRegistry[platform][display.driverKey](project, catalog, component, display),
    ...Object.values(fonts).map(font => 'LV_FONT_DECLARE(' + font.symbol + '); /* asset ' + font.sha256 + ' */'),
    'static uint32_t clex_graphics_tick(void) { return (uint32_t)(esp_timer_get_time() / 1000LL); }',
    'static bool clex_graphics_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *event, void *context) { (void)io; (void)event; lv_display_flush_ready((lv_display_t *)context); return false; }',
    'static void clex_graphics_flush(lv_display_t *display, const lv_area_t *area, uint8_t *pixels) {',
    '  lv_draw_sw_rgb565_swap(pixels, (area->x2 - area->x1 + 1) * (area->y2 - area->y1 + 1));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(clex_panel, area->x1, area->y1, area->x2 + 1, area->y2 + 1, pixels));',
    '  (void)display; /* Completion is signalled only by the DMA callback. */',
    '}',
    'static void clex_graphics_initialize(void) {',
    '  clex_panel_initialize();',
    '  lv_init(); lv_tick_set_cb(clex_graphics_tick);',
    '  lv_display_t *display = lv_display_create(' + width + ', ' + height + ');',
    '  void *buffer = heap_caps_malloc(' + width + ' * 20 * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);',
    '  if (!display || !buffer) { ESP_LOGE("CLEX", "Cannot allocate display buffers"); abort(); }',
    '  lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);',
    '  lv_display_set_buffers(display, buffer, NULL, ' + width + ' * 20 * 2, LV_DISPLAY_RENDER_MODE_PARTIAL);',
    '  lv_display_set_flush_cb(display, clex_graphics_flush);',
    '  esp_lcd_panel_io_callbacks_t callbacks = { .on_color_trans_done = clex_graphics_done };',
    '  ESP_ERROR_CHECK(esp_lcd_panel_io_register_event_callbacks(clex_panel_io, &callbacks, display));',
    '  lv_display_set_default(display);',
    '  lv_obj_t *screen = lv_screen_active();',
    '  lv_obj_set_style_bg_color(screen, lv_color_hex(' + color(screen.background) + '), LV_PART_MAIN);',
    '  lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);',
    '  lv_obj_set_style_pad_all(screen, 0, LV_PART_MAIN);',
    '  lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);',
    ...screen.elements.flatMap((element,i) => {
      const symbol = fontSymbols[element.fontId];
      if (!symbol) throw new Error('Нет реализации выбранного шрифта.');
      return [
        '  lv_obj_t *text_' + i + ' = lv_label_create(screen);',
        '  lv_label_set_text(text_' + i + ', ' + cString(element.text) + ');',
        '  lv_label_set_long_mode(text_' + i + ', LV_LABEL_LONG_CLIP);',
        '  lv_obj_set_size(text_' + i + ', ' + (width - element.x) + ', ' + (height - element.y) + ');',
        '  lv_obj_set_style_text_font(text_' + i + ', &' + symbol + ', LV_PART_MAIN);',
        '  lv_obj_set_style_text_color(text_' + i + ', lv_color_hex(' + color(element.color) + '), LV_PART_MAIN);',
        '  lv_obj_set_style_text_line_space(text_' + i + ', 0, LV_PART_MAIN);',
        '  lv_obj_set_pos(text_' + i + ', ' + element.x + ', ' + element.y + ');',
      ];
    }),
    '}',
  ].join('\n');
  return { runtime: GRAPHICS_RUNTIME, source, initialize: '  clex_graphics_initialize();', update: '    lv_timer_handler();' };
}
