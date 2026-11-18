export function esp32CameraDvp(provider, slot) {
  const camera = 'clex_camera_' + slot;
  const signals = Object.entries(provider.signals).map(([name, gpio]) => '  .pin_' + name + ' = ' + gpio + ',').join('\n');
  return `#include "esp_camera.h"
#ifndef CONFIG_SPIRAM
#error "ESP32-CAM requires PSRAM for JPEG capture"
#endif
static QueueHandle_t ${camera}_commands;

static void ${camera}_worker(void *argument) {
  (void)argument;
  const camera_config_t config = {
${signals}
    .xclk_freq_hz = 20000000,
    .ledc_timer = LEDC_TIMER_0,
    .ledc_channel = LEDC_CHANNEL_0,
    .pixel_format = PIXFORMAT_JPEG,
    .frame_size = FRAMESIZE_VGA,
    .jpeg_quality = 14,
    .fb_count = 1,
    .fb_location = CAMERA_FB_IN_PSRAM,
    .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
  };
  const esp_err_t initialized = esp_camera_init(&config);
  uint32_t count = 0;
  clex_media_command_t command;
  for (;;) {
    if (xQueueReceive(${camera}_commands, &command, portMAX_DELAY) != pdTRUE) {
      continue;
    }
    clex_media_snapshot_t value = {.frames = count};
    if (initialized == ESP_ERR_CAMERA_NOT_DETECTED || initialized == ESP_ERR_CAMERA_NOT_SUPPORTED) {
      snprintf(value.error, sizeof(value.error), "Camera: OV2640 or OV3660 not detected");
    } else if (initialized != ESP_OK) {
      snprintf(value.error, sizeof(value.error), "Camera: %s", esp_err_to_name(initialized));
    } else {
      camera_fb_t *frame = esp_camera_fb_get();
      if (frame == NULL) {
        snprintf(value.error, sizeof(value.error), "Camera: no frame received");
      } else {
        value.success = true;
        value.frames = ++count;
        value.width = frame->width;
        value.height = frame->height;
        value.bytes = frame->len;
        esp_camera_fb_return(frame);
      }
    }
    clex_media_publish(command.node, &value);
  }
}

static void ${camera}_start(void) {
  ${camera}_commands = xQueueCreate(4, sizeof(clex_media_command_t));
  if (${camera}_commands == NULL ||
      xTaskCreate(${camera}_worker, "clex_camera", 4096, NULL, 4, NULL) != pdPASS) {
    ESP_LOGE("CLEX_CAMERA", "Cannot start camera worker");
    abort();
  }
}

static bool __attribute__((unused)) ${camera}_request(uint16_t node) {
  const clex_media_command_t command = {.node = node};
  return xQueueSend(${camera}_commands, &command, 0) == pdTRUE;
}
`;
}
