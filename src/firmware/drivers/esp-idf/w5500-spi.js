export function w5500Spi(component, provider, slot, targets, cString) {
  const p=provider.signals, host=Number(component.parameters.spiHost), stem='clex_ethernet_'+slot;
  const config=component.parameters;
  const ipLiteral=value=>cString(value.split('.').map(Number).join('.'));
  return `
static struct { esp_eth_handle_t handle; esp_netif_t *netif; esp_eth_netif_glue_handle_t glue; esp_eth_mac_t *mac; esp_eth_phy_t *phy; esp_event_handler_instance_t eth_events, ip_events; bool bus_owned, started, isr_owned; clex_ethernet_snapshot_t snapshot; } ${stem};
static void ${stem}_publish(unsigned flags) {
  ESP_LOGI("CLEX_ETH", "state=%d link=%d ip=%s mask=%s gateway=%s dns=%s error=%s", ${stem}.snapshot.state, ${stem}.snapshot.link, ${stem}.snapshot.ip, ${stem}.snapshot.netmask, ${stem}.snapshot.gateway, ${stem}.snapshot.dns, ${stem}.snapshot.error);
  clex_network_changed();
${targets.map(node=>`  { clex_flow_event_t event = {.node = ${node}, .kind = CLEX_EVENT_ETHERNET, .flags = flags}; event.payload.ethernet = ${stem}.snapshot; clex_network_enqueue(&event); }`).join('\n')}
}
static void ${stem}_handler(void *argument, esp_event_base_t base, int32_t id, void *data) {
  (void)argument;
  if (base == ETH_EVENT) {
    if (!data || *(esp_eth_handle_t *)data != ${stem}.handle) return;
    if (id == ETHERNET_EVENT_CONNECTED) { ${stem}.snapshot = (clex_ethernet_snapshot_t){.link = true, .state = 1}; ${stem}_publish(CLEX_LINK_UP); }
    else if (id == ETHERNET_EVENT_DISCONNECTED || id == ETHERNET_EVENT_STOP) { unsigned flags = (${stem}.snapshot.link ? CLEX_LINK_DOWN : 0) | (${stem}.snapshot.has_ip ? CLEX_IP_CHANGED : 0); ${stem}.snapshot = (clex_ethernet_snapshot_t){0}; ${stem}_publish(flags); }
    else if (id == ETHERNET_EVENT_START) ${stem}_publish(0);
    return;
  }
  if (base != IP_EVENT || (id != IP_EVENT_ETH_GOT_IP && id != IP_EVENT_ETH_LOST_IP)) return;
  ip_event_got_ip_t *event = data;
  if (!event || event->esp_netif != ${stem}.netif) return;
  if (id == IP_EVENT_ETH_LOST_IP || !event->ip_info.ip.addr) {
    bool link = ${stem}.snapshot.link; ${stem}.snapshot = (clex_ethernet_snapshot_t){.link = link, .state = link ? 1 : 0};
  } else {
    if (!${stem}.snapshot.link) return;
    ${stem}.snapshot.has_ip = true; ${stem}.snapshot.state = 2;
    snprintf(${stem}.snapshot.ip, sizeof(${stem}.snapshot.ip), IPSTR, IP2STR(&event->ip_info.ip));
    snprintf(${stem}.snapshot.netmask, sizeof(${stem}.snapshot.netmask), IPSTR, IP2STR(&event->ip_info.netmask));
    snprintf(${stem}.snapshot.gateway, sizeof(${stem}.snapshot.gateway), IPSTR, IP2STR(&event->ip_info.gw));
    esp_netif_dns_info_t dns;
    ${stem}.snapshot.dns[0] = 0;
    if (esp_netif_get_dns_info(${stem}.netif, ESP_NETIF_DNS_MAIN, &dns) == ESP_OK) {
      if (dns.ip.type == ESP_IPADDR_TYPE_V4 && dns.ip.u_addr.ip4.addr) esp_ip4addr_ntoa(&dns.ip.u_addr.ip4, ${stem}.snapshot.dns, sizeof(${stem}.snapshot.dns));
#if CONFIG_LWIP_IPV6
      else if (dns.ip.type == ESP_IPADDR_TYPE_V6) ip6addr_ntoa_r((const ip6_addr_t *)&dns.ip.u_addr.ip6, ${stem}.snapshot.dns, sizeof(${stem}.snapshot.dns));
#endif
    }
  }
  ${stem}_publish(CLEX_IP_CHANGED);
}
static void ${stem}_cleanup(void) {
  if (${stem}.started) { esp_eth_stop(${stem}.handle); ${stem}.started = false; }
  if (${stem}.eth_events) esp_event_handler_instance_unregister(ETH_EVENT, ESP_EVENT_ANY_ID, ${stem}.eth_events);
  if (${stem}.ip_events) esp_event_handler_instance_unregister(IP_EVENT, ESP_EVENT_ANY_ID, ${stem}.ip_events);
  if (${stem}.glue) esp_eth_del_netif_glue(${stem}.glue);
  if (${stem}.handle) esp_eth_driver_uninstall(${stem}.handle);
  if (${stem}.mac) ${stem}.mac->del(${stem}.mac);
  if (${stem}.phy) ${stem}.phy->del(${stem}.phy);
  if (${stem}.netif) esp_netif_destroy(${stem}.netif);
  if (${stem}.bus_owned) spi_bus_free(SPI${host}_HOST);
  if (${stem}.isr_owned) gpio_uninstall_isr_service();
  memset(&${stem}, 0, sizeof(${stem}));
}
static void ${stem}_initialize(void) {
  esp_err_t result = gpio_install_isr_service(0);
  if (result == ESP_OK) ${stem}.isr_owned = true; else if (result != ESP_ERR_INVALID_STATE) goto failure;
  spi_bus_config_t bus = {.mosi_io_num = ${p.mosi}, .miso_io_num = ${p.miso}, .sclk_io_num = ${p.sclk}, .quadwp_io_num = -1, .quadhd_io_num = -1};
  if ((result = spi_bus_initialize(SPI${host}_HOST, &bus, SPI_DMA_CH_AUTO)) != ESP_OK) goto failure;
  ${stem}.bus_owned = true;
  spi_device_interface_config_t device = {.mode = 0, .clock_speed_hz = ${provider.clockHz}, .spics_io_num = ${p.cs}, .queue_size = 20};
  eth_w5500_config_t chip = ETH_W5500_DEFAULT_CONFIG(SPI${host}_HOST, &device); chip.int_gpio_num = ${p.interrupt};
  eth_mac_config_t mac_config = ETH_MAC_DEFAULT_CONFIG(); eth_phy_config_t phy_config = ETH_PHY_DEFAULT_CONFIG();
  phy_config.phy_addr = ${provider.phyAddress}; phy_config.reset_gpio_num = ${p.reset};
  ${stem}.mac = esp_eth_mac_new_w5500(&chip, &mac_config); ${stem}.phy = esp_eth_phy_new_w5500(&phy_config);
  if (!${stem}.mac || !${stem}.phy) { result = ESP_ERR_NO_MEM; goto failure; }
  esp_eth_config_t driver = ETH_DEFAULT_CONFIG(${stem}.mac, ${stem}.phy);
  if ((result = esp_eth_driver_install(&driver, &${stem}.handle)) != ESP_OK) goto failure;
  uint8_t mac[6]; if ((result = esp_read_mac(mac, ESP_MAC_ETH)) != ESP_OK) goto failure;
  if ((result = esp_eth_ioctl(${stem}.handle, ETH_CMD_S_MAC_ADDR, mac)) != ESP_OK) goto failure;
  esp_netif_config_t net_config = ESP_NETIF_DEFAULT_ETH();
  esp_netif_inherent_config_t base = *net_config.base; base.if_key = ${cString(component.id)}; base.if_desc = "clex_ethernet"; net_config.base = &base;
  ${stem}.netif = esp_netif_new(&net_config); if (!${stem}.netif) { result = ESP_ERR_NO_MEM; goto failure; }
  ${stem}.glue = esp_eth_new_netif_glue(${stem}.handle); if (!${stem}.glue) { result = ESP_ERR_NO_MEM; goto failure; }
  if ((result = esp_netif_attach(${stem}.netif, ${stem}.glue)) != ESP_OK) goto failure;
${config.addressMode==='static'?`  if ((result = esp_netif_dhcpc_stop(${stem}.netif)) != ESP_OK && result != ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED) goto failure;
  esp_netif_ip_info_t info; memset(&info, 0, sizeof(info));
  if ((result = esp_netif_str_to_ip4(${ipLiteral(config.staticIp)}, &info.ip)) != ESP_OK || (result = esp_netif_str_to_ip4(${ipLiteral(config.netmask)}, &info.netmask)) != ESP_OK || (result = esp_netif_str_to_ip4(${ipLiteral(config.gateway)}, &info.gw)) != ESP_OK) goto failure;
  if ((result = esp_netif_set_ip_info(${stem}.netif, &info)) != ESP_OK) goto failure;
${config.dns?`  esp_netif_dns_info_t dns = {.ip.type = ESP_IPADDR_TYPE_V4}; if ((result = esp_netif_str_to_ip4(${ipLiteral(config.dns)}, &dns.ip.u_addr.ip4)) != ESP_OK) goto failure;
  if ((result = esp_netif_set_dns_info(${stem}.netif, ESP_NETIF_DNS_MAIN, &dns)) != ESP_OK) goto failure;`:''}`:''}
  if ((result = esp_event_handler_instance_register(ETH_EVENT, ESP_EVENT_ANY_ID, ${stem}_handler, NULL, &${stem}.eth_events)) != ESP_OK) goto failure;
  if ((result = esp_event_handler_instance_register(IP_EVENT, ESP_EVENT_ANY_ID, ${stem}_handler, NULL, &${stem}.ip_events)) != ESP_OK) goto failure;
  if ((result = esp_eth_start(${stem}.handle)) != ESP_OK) goto failure;
  ${stem}.started = true; return;
failure:
  ${stem}_cleanup(); ${stem}.snapshot.state = 3; snprintf(${stem}.snapshot.error, sizeof(${stem}.snapshot.error), "%s", esp_err_to_name(result)); ${stem}_publish(0);
}
`;
}
