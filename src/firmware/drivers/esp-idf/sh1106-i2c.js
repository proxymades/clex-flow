import { i2cAddress } from '../../../hardware/i2c.js';

export function sh1106I2c(project, catalog, component, display) {
  const board = catalog.boards.find(board => board.id === project.boardId);
  const module = catalog.modules.find(module => module.id === component.moduleId);
  const address = '0x' + i2cAddress(component, module).toString(16).toUpperCase();
  const {width, height} = display.resolution;
  const offset = display.initialization.xGap;
  if (width !== 128 || height !== 64 || offset !== 2) throw new Error("Драйвер SH1106 настроен для OLED 128×64 со смещением 2 столбца.");
  const source = `#include "driver/i2c_master.h"
#include "lvgl.h"
#include "esp_heap_caps.h"

enum { CLEX_SH1106_WIDTH = ${width}, CLEX_SH1106_PAGES = ${height / 8}, CLEX_SH1106_OFFSET = ${offset} };
static i2c_master_dev_handle_t clex_sh1106;
static bool clex_sh1106_on;

static void clex_panel_initialize(void) {
  i2c_master_bus_handle_t bus = clex_i2c_bus(${component.parameters.i2cPort});
  if (!bus) {
    ESP_LOGE("CLEX_SH1106", "I2C${component.parameters.i2cPort} is unavailable");
    return;
  }
  const i2c_device_config_t config = {
    .dev_addr_length = I2C_ADDR_BIT_LEN_7,
    .device_address = ${address},
    .scl_speed_hz = ${module.i2c.frequencyHz},
  };
  esp_err_t result = i2c_master_bus_add_device(bus, &config, &clex_sh1106);
  if (result == ESP_OK) {
    const uint8_t init[] = {
      0x00, 0xAE,                         /* Command stream, display off */
      0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40,
      0xAD, 0x8B, 0x33,                   /* Internal DC-DC, VPP 9 V */
      0xA1, 0xC8, 0xDA, 0x12,             /* Segment/COM direction */
      0x81, 0x80, 0xD9, 0x1F, 0xDB, 0x40, 0xA4, 0xA6,
    };
    vTaskDelay(pdMS_TO_TICKS(100));
    result = i2c_master_transmit(clex_sh1106, init, sizeof(init), 50);
    if (result != ESP_OK) {
      i2c_master_bus_rm_device(clex_sh1106);
      clex_sh1106 = NULL;
    }
  }
  if (result != ESP_OK) {
    ESP_LOGE("CLEX_SH1106", "I2C${component.parameters.i2cPort} address ${address}: %s", esp_err_to_name(result));
    return;
  }
  ESP_LOGI("CLEX_SH1106", "I2C${component.parameters.i2cPort} address ${address} initialized");
}

static esp_err_t clex_sh1106_write_frame(const uint16_t *pixels) {
  uint8_t bytes[CLEX_SH1106_WIDTH + 1] = {0x40};
  for (int page = 0; page < CLEX_SH1106_PAGES; page++) {
    const uint8_t commands[] = {0x00, 0xB0 | page, 0x00 | (CLEX_SH1106_OFFSET & 0x0F), 0x10 | (CLEX_SH1106_OFFSET >> 4)};
    esp_err_t result = i2c_master_transmit(clex_sh1106, commands, sizeof(commands), 50);
    if (result != ESP_OK) {
      return result;
    }
    for (int x = 0; x < CLEX_SH1106_WIDTH; x++) {
      uint8_t column = 0;
      for (int bit = 0; bit < 8; bit++) {
        const uint16_t rgb = pixels[((page * 8 + bit) * CLEX_SH1106_WIDTH) + x];
        const unsigned red = ((rgb >> 11) & 31) * 255 / 31;
        const unsigned green = ((rgb >> 5) & 63) * 255 / 63;
        const unsigned blue = (rgb & 31) * 255 / 31;
        if (red * 2126 + green * 7152 + blue * 722 >= 1280000) {
          column |= 1u << bit;
        }
      }
      bytes[x + 1] = column;
    }
    result = i2c_master_transmit(clex_sh1106, bytes, sizeof(bytes), 50);
    if (result != ESP_OK) {
      return result;
    }
  }
  if (!clex_sh1106_on) {
    const uint8_t on[] = {0x00, 0xAF};
    const esp_err_t result = i2c_master_transmit(clex_sh1106, on, sizeof(on), 50);
    clex_sh1106_on = result == ESP_OK;
    return result;
  }
  return ESP_OK;
}`;
  const flush = `static void clex_graphics_flush(lv_display_t *display, const lv_area_t *area, uint8_t *pixels) {
  (void)area; /* Full-screen RGB565 buffer. SH1106 accepts vertical 8-pixel pages. */
  if (clex_sh1106) {
    const esp_err_t result = clex_sh1106_write_frame((const uint16_t *)pixels);
    if (result != ESP_OK) {
      ESP_LOGE("CLEX_SH1106", "Display update: %s", esp_err_to_name(result));
    }
  }
  lv_display_flush_ready(display);
}`;
  return { source, flush, features: ['sh1106-' + board.target] };
}
