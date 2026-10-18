// All access to the one physical sensor runs in flow_worker, including manual reads.
export const TEMPERATURE_RUNTIME = String.raw`
typedef struct { float value; bool valid; char text[48],error[96]; int64_t due; } clex_temperature_value_t;
static temperature_sensor_handle_t clex_temperature_handle;
static esp_err_t clex_temperature_init_error;
static void clex_temperature_initialize(void) {
  temperature_sensor_config_t config = TEMPERATURE_SENSOR_CONFIG_DEFAULT(-10, 80);
  clex_temperature_init_error = temperature_sensor_install(&config, &clex_temperature_handle);
  if (clex_temperature_init_error == ESP_OK) {
    clex_temperature_init_error = temperature_sensor_enable(clex_temperature_handle);
    if (clex_temperature_init_error != ESP_OK) {
      temperature_sensor_uninstall(clex_temperature_handle);
      clex_temperature_handle = NULL;
    }
  }
  if (clex_temperature_init_error != ESP_OK) ESP_LOGE("CLEX_TEMP", "Sensor initialization: %s", esp_err_to_name(clex_temperature_init_error));
}
static bool clex_temperature_read(clex_temperature_value_t *state) {
  float measured = NAN;
  esp_err_t result = clex_temperature_init_error;
  if (result == ESP_OK) result = temperature_sensor_get_celsius(clex_temperature_handle, &measured);
  if (result == ESP_OK && !isfinite(measured)) result = ESP_FAIL;
  state->valid = result == ESP_OK;
  state->value = state->valid ? measured : NAN;
  if (state->valid) {
    snprintf(state->text, sizeof(state->text), "%.1f °C", (double)measured);
    state->error[0] = 0;
  } else {
    snprintf(state->text, sizeof(state->text), "%s", "Нет данных");
    snprintf(state->error, sizeof(state->error), "Temperature sensor: %s", esp_err_to_name(result));
  }
  return state->valid;
}
`;
