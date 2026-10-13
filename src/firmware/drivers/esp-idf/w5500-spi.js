import { ethernetInterface } from './ethernet-interface.js';
export function w5500Spi(component, provider, slot, targets, cString) {
  const p=provider.signals, host=Number(component.parameters.spiHost), stem='clex_ethernet_'+slot;
  return ethernetInterface(component, slot, targets, cString, {
    fields: 'bool bus_owned, isr_owned;',
    initialize: `  esp_err_t result = gpio_install_isr_service(0);
  if (result == ESP_OK) ${stem}.isr_owned = true; else if (result != ESP_ERR_INVALID_STATE) goto failure;
  spi_bus_config_t bus = {.mosi_io_num = ${p.mosi}, .miso_io_num = ${p.miso}, .sclk_io_num = ${p.sclk}, .quadwp_io_num = -1, .quadhd_io_num = -1};
  if ((result = spi_bus_initialize(SPI${host}_HOST, &bus, SPI_DMA_CH_AUTO)) != ESP_OK) goto failure;
  ${stem}.bus_owned = true;
  spi_device_interface_config_t device = {.mode = 0, .clock_speed_hz = ${provider.clockHz}, .spics_io_num = ${p.cs}, .queue_size = 20};
  eth_w5500_config_t chip = ETH_W5500_DEFAULT_CONFIG(SPI${host}_HOST, &device); chip.int_gpio_num = ${p.interrupt};
  eth_mac_config_t mac_config = ETH_MAC_DEFAULT_CONFIG(); eth_phy_config_t phy_config = ETH_PHY_DEFAULT_CONFIG();
  phy_config.phy_addr = ${provider.phyAddress}; phy_config.reset_gpio_num = ${p.reset};
  ${stem}.mac = esp_eth_mac_new_w5500(&chip, &mac_config); ${stem}.phy = esp_eth_phy_new_w5500(&phy_config);`,
    cleanup: `  if (${stem}.bus_owned) spi_bus_free(SPI${host}_HOST);
  if (${stem}.isr_owned) gpio_uninstall_isr_service();`,
  });
}
