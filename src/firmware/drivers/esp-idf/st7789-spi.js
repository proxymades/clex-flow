export function st7789Spi(project, catalog, component, display) {
  if (display.controllerId !== 'sitronix.st7789' || display.interface !== 'spi') throw new Error('Этот драйвер требует контроллер ST7789 и интерфейс SPI.');
  const { width, height } = display.resolution, init = display.initialization;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || width > 240 || height <= 0 || height > 320 || init.xGap + width > 240 || init.yGap + height > 320) throw new Error('Размер или смещение модуля выходит за адресное пространство контроллера.');
  const module = catalog.modules.find(module => module.id === component.moduleId);
  const gpio = signal => {
    const terminal = module.terminals.find(terminal => terminal.signal === signal);
    const assignment = project.gpioAssignments.find(item => item.componentId === component.id && item.terminalId === terminal?.id);
    if (!assignment || assignment.mode !== 'output') throw new Error('Назначьте сигнал дисплея: ' + signal);
    return assignment.gpio;
  };
  const host = Number(component.parameters.spiHost);
  if (![2,3].includes(host) || !catalog.boards.find(board => board.id === project.boardId)?.interfaces?.spi.hosts.includes(host)) throw new Error('Выбранный аппаратный SPI недоступен на плате.');
  const rgb = { RGB: 'LCD_RGB_ELEMENT_ORDER_RGB', BGR: 'LCD_RGB_ELEMENT_ORDER_BGR' }[init.rgbOrder];
  if (!rgb) throw new Error('Неизвестный порядок цветовых элементов дисплея.');
  return [
    '#include "lvgl.h"',
    '#include "driver/spi_master.h"',
    '#include "esp_heap_caps.h"',
    '#include "esp_lcd_panel_io.h"',
    '#include "esp_lcd_panel_vendor.h"',
    '#include "esp_lcd_panel_ops.h"',
    'static esp_lcd_panel_handle_t clex_panel;',
    'static esp_lcd_panel_io_handle_t clex_panel_io;',
    'static void clex_panel_initialize(void) {',
    '  spi_bus_config_t bus = { .sclk_io_num = ' + gpio('clock') + ', .mosi_io_num = ' + gpio('data') + ', .miso_io_num = -1, .quadwp_io_num = -1, .quadhd_io_num = -1, .max_transfer_sz = ' + width + ' * 20 * 2 };',
    '  ESP_ERROR_CHECK(spi_bus_initialize(SPI' + host + '_HOST, &bus, SPI_DMA_CH_AUTO));',
    '  esp_lcd_panel_io_spi_config_t io_config = { .dc_gpio_num = ' + gpio('command') + ', .cs_gpio_num = ' + gpio('select') + ', .pclk_hz = ' + init.pixelClockHz + ', .lcd_cmd_bits = ' + init.commandBits + ', .lcd_param_bits = ' + init.parameterBits + ', .spi_mode = ' + init.spiMode + ', .trans_queue_depth = 1 };',
    '  ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI' + host + '_HOST, &io_config, &clex_panel_io));',
    '  esp_lcd_panel_dev_config_t panel_config = { .reset_gpio_num = ' + gpio('reset') + ', .rgb_ele_order = ' + rgb + ', .bits_per_pixel = 16 };',
    '  ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(clex_panel_io, &panel_config, &clex_panel));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_reset(clex_panel));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_init(clex_panel));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_invert_color(clex_panel, ' + String(init.invertColors) + '));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_set_gap(clex_panel, ' + init.xGap + ', ' + init.yGap + '));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_mirror(clex_panel, ' + String(init.mirrorX) + ', ' + String(init.mirrorY) + '));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(clex_panel, ' + String(init.swapXY) + '));',
    '  ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(clex_panel, true));',
    '}',
  ].join('\n');
}
