import { ethernetInterface } from './ethernet-interface.js';
export function ip101Rmii(component, provider, slot, targets, cString) {
  const p = provider.signals, stem = 'clex_ethernet_' + slot;
  if (provider.interface !== 'rmii' || provider.controller !== 'IP101GRI') throw new Error('Драйвер требует IP101GRI и RMII.');
  return ethernetInterface(component, slot, targets, cString, {
    fields: '', cleanup: '',
    initialize: `  esp_err_t result = ESP_OK;
  eth_mac_config_t mac_config = ETH_MAC_DEFAULT_CONFIG(); eth_phy_config_t phy_config = ETH_PHY_DEFAULT_CONFIG();
  phy_config.phy_addr = ${provider.phyAddress}; phy_config.reset_gpio_num = ${p.reset};
  eth_esp32_emac_config_t emac = ETH_ESP32_EMAC_DEFAULT_CONFIG();
  emac.smi_gpio.mdc_num = ${p.mdc}; emac.smi_gpio.mdio_num = ${p.mdio};
  emac.interface = EMAC_DATA_INTERFACE_RMII;
  emac.clock_config.rmii.clock_mode = EMAC_CLK_EXT_IN;
  emac.clock_config.rmii.clock_gpio = (emac_rmii_clock_gpio_t)${p.clock};
  emac.emac_dataif_gpio.rmii = (eth_mac_rmii_gpio_config_t){.tx_en_num = ${p.txEn}, .txd0_num = ${p.txd0}, .txd1_num = ${p.txd1}, .crs_dv_num = ${p.crsDv}, .rxd0_num = ${p.rxd0}, .rxd1_num = ${p.rxd1}};
  ${stem}.mac = esp_eth_mac_new_esp32(&emac, &mac_config); ${stem}.phy = esp_eth_phy_new_ip101(&phy_config);`,
  });
}
