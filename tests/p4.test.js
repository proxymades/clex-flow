import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, led } from './catalog-fixture.js';
import { p4Project } from './p4-fixture.js';
import { createProject, serializeProject, parseProject } from '../src/projects/model.js';
import { addHardware, connectionProblem, validateAssembly } from '../src/assembly/model.js';
import { generateFirmware, firmwareFingerprint } from '../src/firmware/generator.js';
import { spiUsage } from '../src/network/model.js';
const board = catalog.boards.find(board => board.id === 'waveshare-esp32-p4-nano');
test('P4 headers match schematic numbering; C6, UART, onboard controls and internal LDO are not assignable GPIO', () => {
  assert.equal(board.pins.length, 52);
  assert.equal(new Set(board.pins.map(pin => pin.id)).size, 52);
  const pins = Object.fromEntries(board.pins.map(pin => [pin.id, pin]));
  for (const [id,label] of [['P1-1','3V3'],['P1-2','5V'],['P1-7','GPIO23'],['P1-8','GPIO37'],['P1-26','GPIO36'],['P2-1','5V'],['P2-2','ESP_LDO_VO4'],['P2-19','GPIO45'],['P2-20','C6_RXD'],['P2-26','GND']]) assert.equal(pins[id].label,label);
  let project = addHardware(createProject('P4 pins', '', board.id),led,catalog);
  for (const id of ['P1-8','P1-10','P2-20','P2-2','P2-19','P2-12','P1-3']) assert.ok(connectionProblem(project,catalog,project.components[0].id,'anode',id));
  for (const id of ['P1-7','P2-9','P2-11','P1-12','P1-11']) assert.equal(connectionProblem(project,catalog,project.components[0].id,'anode',id),null);
});
test('P4 dynamic LVGL firmware keeps Cyrillic, normal graph updates, RISC-V target and UART; persists with original format', async () => {
  const project=p4Project(), bundle=generateFirmware(project,catalog);
  assert.equal(bundle.target,'esp32p4'); assert.equal(bundle.consoleMode,'uart');
  assert.deepEqual(validateAssembly(project,catalog).filter(issue=>issue.severity==='error'),[]);
  assert.match(bundle.mainC,/lv_label_set_text_fmt/); assert.match(bundle.mainC,/sclk_io_num = 20/);
  assert.match(bundle.files['sdkconfig.defaults'],/CONFIG_ESP_CONSOLE_UART_DEFAULT=y/);
  assert.match(bundle.files['sdkconfig.defaults'],/CONFIG_ESP32P4_SELECTS_REV_LESS_V3=y/);
  assert.match(bundle.files['sdkconfig.defaults'],/CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y/);
  assert.equal(parseProject(serializeProject(project)).formatVersion,3);
  const modern=generateFirmware(p4Project(false,'v3'),catalog);
  // IDs are identical for a revision-only change, so fingerprint must still invalidate build.
  const changed=generateFirmware({...project,boardSettings:{chipRevision:'v3'}},catalog);
  assert.notEqual(await firmwareFingerprint(bundle),await firmwareFingerprint(changed));
  assert.match(modern.files['sdkconfig.defaults'],/CONFIG_ESP32P4_REV_MIN_300=y/);
  assert.throws(()=>generateFirmware({...project,boardSettings:{chipRevision:'arbitrary'}},catalog),/Ревизия|ревизию/);
});
test('P4 built-in Ethernet selects actual IP101/RMII, keeps link/IP/reset events, does not claim a display SPI bus', () => {
  const project=p4Project(true),bundle=generateFirmware(project,catalog);
  assert.equal(spiUsage(project,catalog).length,1);
  assert.match(bundle.mainC,/esp_eth_mac_new_esp32/); assert.match(bundle.mainC,/esp_eth_phy_new_ip101/);
  assert.match(bundle.mainC,/mdc_num = 31/); assert.match(bundle.mainC,/mdio_num = 52/);
  assert.match(bundle.mainC,/reset_gpio_num = 51/); assert.match(bundle.mainC,/ETHERNET_EVENT_DISCONNECTED/);
  assert.match(bundle.mainC,/esp_read_mac\(mac, ESP_MAC_ETH\)/);
  assert.doesNotMatch(bundle.mainC,/esp_eth_mac_new_w5500|bus_owned|gpio_install_isr_service/);
  assert.match(bundle.files['sdkconfig.defaults'],/CONFIG_ETH_USE_ESP32_EMAC=y/);
  assert.doesNotMatch(bundle.files['sdkconfig.defaults'],/CONFIG_ETH_SPI_ETHERNET_W5500/);
});

test('new hardware placement uses actual board dimensions and avoids the wide P4 board', () => {
 const project=addHardware(createProject('P4 layout','',board.id),led,catalog);
 const position=project.assembly.positions[project.components[0].id], b=project.assembly.positions.board;
 assert.ok(position.x >= b.x + board.width + 20 || position.y >= b.y + board.height + 20);
});
