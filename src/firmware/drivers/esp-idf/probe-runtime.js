export const PROBE_RUNTIME = String.raw`
typedef struct { atomic_uint references; SemaphoreHandle_t done; char host[254]; ip_addr_t address; err_t error; } clex_dns_request_t;
static TaskHandle_t clex_probe_task_handle;
static atomic_bool clex_network_stopping;
static void clex_dns_release(clex_dns_request_t *request) {
  if (atomic_fetch_sub(&request->references, 1) == 1) { vSemaphoreDelete(request->done); free(request); }
}
static void clex_dns_complete(const char *name, const ip_addr_t *address, void *argument) {
  (void)name; clex_dns_request_t *request = argument;
  request->error = address ? ERR_OK : ERR_VAL;
  if (address) request->address = *address;
  xSemaphoreGive(request->done); clex_dns_release(request);
}
static void clex_dns_start(void *argument) {
  clex_dns_request_t *request = argument;
  request->error = dns_gethostbyname_addrtype(request->host, &request->address, clex_dns_complete, request, LWIP_DNS_ADDRTYPE_IPV4);
  if (request->error != ERR_INPROGRESS) { xSemaphoreGive(request->done); clex_dns_release(request); }
}
static bool clex_route_ready(void) {
  esp_netif_t *route = esp_netif_get_default_netif(); esp_netif_ip_info_t info;
  return route && esp_netif_is_netif_up(route) && esp_netif_get_ip_info(route, &info) == ESP_OK && info.ip.addr != 0;
}
static int clex_request_timeout_ms(int64_t deadline) {
  int64_t remaining = deadline - esp_timer_get_time();
  return remaining > 0 ? (int)((remaining + 999) / 1000) : 1;
}
static bool clex_request_current(uint32_t generation, int64_t deadline) {
  return !atomic_load(&clex_network_stopping) && atomic_load(&clex_network_generation) == generation && esp_timer_get_time() < deadline;
}
static bool clex_dns_resolve(const char *host, uint32_t generation, int64_t deadline, ip_addr_t *address, char *error, size_t size) {
  clex_dns_request_t *request = calloc(1, sizeof(*request));
  if (!request) { snprintf(error, size, "DNS: memory"); return false; }
  request->done = xSemaphoreCreateBinary();
  if (!request->done) { free(request); snprintf(error, size, "DNS: semaphore"); return false; }
  atomic_init(&request->references, 2); snprintf(request->host, sizeof(request->host), "%s", host);
  if (tcpip_callback(clex_dns_start, request) != ERR_OK) { clex_dns_release(request); clex_dns_release(request); snprintf(error, size, "DNS: queue"); return false; }
  bool completed = false;
  while (clex_request_current(generation, deadline)) if (xSemaphoreTake(request->done, pdMS_TO_TICKS(20)) == pdTRUE) { completed = true; break; }
  bool success = completed && request->error == ERR_OK;
  if (success) *address = request->address;
  else snprintf(error, size, "%s", completed ? "DNS: resolution failed" : atomic_load(&clex_network_stopping) ? "DNS: stopped" : generation != atomic_load(&clex_network_generation) ? "DNS: route changed" : "DNS: timeout");
  // A late resolver callback retains its own reference and frees the request.
  clex_dns_release(request); return success;
}
static void clex_probe_publish(unsigned node, const clex_probe_snapshot_t *snapshot, uint32_t generation, bool complete) {
  clex_flow_event_t event = {.node = node, .kind = CLEX_EVENT_PROBE, .flags = complete ? 1 : 0, .generation = generation};
  if (complete) ESP_LOGI("CLEX_HTTP", "state=%d status=%d elapsed=%ld ms error=%s", snapshot->state, snapshot->status_code, (long)snapshot->response_ms, snapshot->error);
  event.payload.probe = *snapshot; clex_network_enqueue(&event);
}
static void clex_network_changed(void) {
  uint32_t generation = atomic_fetch_add(&clex_network_generation, 1) + 1;
  for (size_t i = 0; i < sizeof(clex_probes) / sizeof(clex_probes[0]); i++) {
    clex_probe_snapshot_t waiting = {.state = 0, .response_ms = -1}; clex_probe_publish(clex_probes[i].node, &waiting, generation, false);
  }
  if (clex_probe_task_handle) xTaskNotifyGive(clex_probe_task_handle);
}
static void clex_probe_run(const clex_probe_config_t *config) {
  uint32_t generation = atomic_load(&clex_network_generation);
  clex_probe_snapshot_t snapshot = {.state = 1, .response_ms = -1};
  clex_probe_publish(config->node, &snapshot, generation, false);
  int64_t start = esp_timer_get_time(), deadline = start + (int64_t)config->timeout_ms * 1000;
  esp_http_client_handle_t client = NULL; ip_addr_t address; esp_err_t result = ESP_FAIL;
  const char *phase = config->secure ? "HTTPS connect" : "HTTP connect";
  if (!clex_dns_resolve(config->host, generation, deadline, &address, snapshot.error, sizeof(snapshot.error))) goto finish;
  if (!clex_request_current(generation, deadline)) goto request_failed;
  char resolved[16]; ip4addr_ntoa_r(ip_2_ip4(&address), resolved, sizeof(resolved));
  esp_http_client_config_t settings = {.host = resolved, .path = config->path, .port = config->port,
    .transport_type = config->secure ? HTTP_TRANSPORT_OVER_SSL : HTTP_TRANSPORT_OVER_TCP,
    .common_name = config->host, .crt_bundle_attach = config->secure ? esp_crt_bundle_attach : NULL,
    /* The connection gets the remaining request budget. Short polling starts only after it is established. */
    .timeout_ms = clex_request_timeout_ms(deadline), .is_async = config->secure, .disable_auto_redirect = true,
    .method = config->head ? HTTP_METHOD_HEAD : HTTP_METHOD_GET, .buffer_size = 1024, .buffer_size_tx = 1024};
  client = esp_http_client_init(&settings);
  if (!client) { snprintf(snapshot.error, sizeof(snapshot.error), "HTTP: initialization failed"); goto finish; }
  result = esp_http_client_set_header(client, "Host", config->host_header); if (result != ESP_OK) goto request_failed;
  // Streaming API stops at headers; even GET never downloads an entire body.
  do { result = esp_http_client_open(client, 0); if (result == ESP_OK) break; if (result != ESP_ERR_HTTP_EAGAIN) goto request_failed; vTaskDelay(pdMS_TO_TICKS(10)); } while (clex_request_current(generation, deadline));
  if (result != ESP_OK) goto request_failed;
  phase = "HTTP headers";
  esp_http_client_set_timeout_ms(client, 50);
  while (clex_request_current(generation, deadline)) {
    int64_t headers = esp_http_client_fetch_headers(client);
    if (headers >= 0) { snapshot.status_code = esp_http_client_get_status_code(client); snapshot.available = snapshot.status_code >= 200 && snapshot.status_code < 300; if (!snapshot.available) snprintf(snapshot.error, sizeof(snapshot.error), "HTTP: %d", snapshot.status_code); goto finish; }
    int socket_error = esp_http_client_get_errno(client);
    if (headers != -ESP_ERR_HTTP_EAGAIN && socket_error != EAGAIN && socket_error != EWOULDBLOCK && socket_error != ETIMEDOUT) { result = ESP_ERR_HTTP_FETCH_HEADER; goto request_failed; }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
request_failed:
  if (atomic_load(&clex_network_stopping)) snprintf(snapshot.error, sizeof(snapshot.error), "HTTP: stopped");
  else if (generation != atomic_load(&clex_network_generation)) snprintf(snapshot.error, sizeof(snapshot.error), "HTTP: route changed");
  else if (esp_timer_get_time() >= deadline) snprintf(snapshot.error, sizeof(snapshot.error), "%s:\ntimeout", phase);
  else {
    int tls_code = 0, tls_flags = 0;
    if (client && config->secure) esp_http_client_get_and_clear_last_tls_error(client, &tls_code, &tls_flags);
    if (tls_code || tls_flags) snprintf(snapshot.error, sizeof(snapshot.error), "TLS: 0x%x\nflags: 0x%x", tls_code, tls_flags);
    else snprintf(snapshot.error, sizeof(snapshot.error), "%s:\n%s\nerrno: %d", phase, esp_err_to_name(result), client ? esp_http_client_get_errno(client) : 0);
  }
finish:
  if (client) { esp_http_client_close(client); esp_http_client_cleanup(client); }
  snapshot.response_ms = (int32_t)((esp_timer_get_time() - start) / 1000);
  snapshot.state = snapshot.available ? 2 : 3;
  if (generation != atomic_load(&clex_network_generation) || !clex_route_ready()) { snapshot = (clex_probe_snapshot_t){.state = 0, .response_ms = -1}; generation = atomic_load(&clex_network_generation); }
  clex_probe_publish(config->node, &snapshot, generation, snapshot.state >= 2);
}
static void clex_probe_task(void *argument) {
  (void)argument;
  while (!atomic_load(&clex_network_stopping)) {
    int64_t now = esp_timer_get_time(); bool connected = clex_route_ready();
    for (size_t i = 0; i < sizeof(clex_probes) / sizeof(clex_probes[0]); i++) {
      if (atomic_load(&clex_network_stopping)) break;
      clex_probe_config_t *config = &clex_probes[i];
      if (config->due > now) continue;
      config->due = now + (int64_t)config->interval_ms * 1000;
      if (connected) clex_probe_run(config);
      else { clex_probe_snapshot_t waiting = {.state = 0, .response_ms = -1}; clex_probe_publish(config->node, &waiting, atomic_load(&clex_network_generation), false); }
      now = esp_timer_get_time(); connected = clex_route_ready();
    }
    if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(50))) for (size_t i = 0; i < sizeof(clex_probes) / sizeof(clex_probes[0]); i++) clex_probes[i].due = 0;
  }
  clex_probe_task_handle = NULL; vTaskDelete(NULL);
}
static void clex_probe_start(void) {
  if (xTaskCreate(clex_probe_task, "clex_probe", 12288, NULL, 4, &clex_probe_task_handle) != pdPASS) {
    for (size_t i = 0; i < sizeof(clex_probes) / sizeof(clex_probes[0]); i++) { clex_probe_snapshot_t failure = {.state = 3, .response_ms = -1}; snprintf(failure.error, sizeof(failure.error), "HTTP: worker memory"); clex_probe_publish(clex_probes[i].node, &failure, atomic_load(&clex_network_generation), true); }
  }
}
`;
