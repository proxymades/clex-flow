import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from './catalog-fixture.js';
import {ESP32_BOARD,esp32GpioProject,esp32DisplayProject,esp32EspNowProject,esp32RouterProject,esp32PeripheralProject} from './esp32-firmware-fixture.js';
import {createProject,parseProject,serializeProject} from '../src/projects/model.js';
import {addHardware,connectionProblem,validateAssembly} from '../src/assembly/model.js';
import {moduleSupportsBoard} from '../src/catalog/compatibility.js';
import {validateGraph} from '../src/logic/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {stepperProject} from './stepper-fixture.js';
const board=catalog.boards.find(b=>b.id===ESP32_BOARD);
const supported=['hardware.led','hardware.button','hardware.touch-button','display.spi-240x320','hardware.nema17','hardware.tb6600','hardware.tmc2208','hardware.drv8825','hardware.espnow','hardware.router','logic.timer','logic.counter','logic.stopwatch','logic.serial','logic.gpio-read','logic.gpio-set','logic.gpio-toggle','logic.gpio-edge','logic.select-number','logic.display','logic.stepper','logic.espnow-control','logic.espnow-receive','logic.espnow-send','logic.espnow-ack','logic.router','logic.internet-check'];
test('classic ESP32 enables implemented components and excludes unsupported peripherals',()=>{
 for(const id of supported)assert.equal(moduleSupportsBoard(catalog.modules.find(m=>m.id==='clex.'+id),board),true,id);
 for(const id of ['hardware.ethernet','logic.ethernet','logic.temperature','display.waveshare-10-1-dsi-touch-a','hardware.audio','hardware.camera','logic.tone','logic.camera-capture'])assert.equal(moduleSupportsBoard(catalog.modules.find(m=>m.id==='clex.'+id),board),false,id);
 const p=esp32GpioProject(),led=p.components.find(c=>c.moduleId==='clex.hardware.led'),button=p.components.find(c=>c.moduleId==='clex.hardware.button');
 const inputOnly=board.pins.find(p=>p.gpio===34);
 assert.match(connectionProblem(p,catalog,led.id,'anode',inputOnly.id),/направление/);
 assert.match(connectionProblem(p,catalog,button.id,'signal',inputOnly.id),/подтяжки/);
 const touch=esp32GpioProject({touch:true,inputGpio:34});assert.deepEqual(validateAssembly(touch,catalog).filter(i=>i.severity==='error'),[]);
 for(const gpio of [1,3,2,5,12,15])assert.ok(connectionProblem(p,catalog,led.id,'anode',board.pins.find(pin=>pin.gpio===gpio).id));
});
test('classic ESP32 GPIO, SPI displays, ESP-NOW and motion generate UART firmware with matching runtime profiles',()=>{
 const projects=[esp32GpioProject(),esp32DisplayProject(),esp32DisplayProject(undefined,'3'),esp32EspNowProject({combined:true,rememberMode:true,peerHealth:true}),esp32PeripheralProject(),...['tb6600','tmc2208','drv8825'].map(driver=>stepperProject(driver,ESP32_BOARD).project)];
 for(const p of projects){
  assert.deepEqual([...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(i=>i.severity==='error'),[]);
  assert.deepEqual(parseProject(serializeProject(p)),p);
  const b=generateFirmware(p,catalog,'usb');assert.equal(b.target,'esp32');assert.equal(b.consoleMode,'uart');
  assert.match(b.files['sdkconfig.defaults'],/CONFIG_IDF_TARGET="esp32"/);assert.match(b.files['sdkconfig.defaults'],/CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y/);assert.match(b.files['sdkconfig.defaults'],/CONFIG_ESP_CONSOLE_UART_DEFAULT=y/);assert.doesNotMatch(b.files['sdkconfig.defaults'],/USB_SERIAL_JTAG|CONFIG_SPIRAM=y/);
  if(p.components.some(c=>c.moduleId==='clex.hardware.espnow')){assert.ok(b.featureRuntimes.includes('espnow-esp32'));assert.match(b.mainC,/WIFI_PHY_RATE_LORA_250K/);assert.ok(b.mainC.includes('nvs_set_blob'),'persistent radio mode uses NVS');assert.match(b.files['partitions.csv'],/0x300000/);}
  if(p.components.some(c=>c.moduleId==='clex.hardware.drv8825'))assert.ok(b.featureRuntimes.includes('stepper-esp32'));
 }
});
test('classic ESP32 router uses Wi-Fi WAN and rejects unavailable Ethernet or oversized OTA layout',()=>{
 const empty=createProject('Router defaults','',ESP32_BOARD,{}),module=catalog.modules.find(m=>m.id==='clex.hardware.router');
 const added=addHardware(empty,module,catalog),router=added.components[0];assert.equal(router.parameters.wanSource,'wifi');assert.equal(router.parameters.otaEnabled,false);
 const p=esp32RouterProject({probe:true,display:true});assert.deepEqual([...validateAssembly(p,catalog),...validateGraph(p,catalog)].filter(i=>i.severity==='error'),[]);
 const b=generateFirmware(p,catalog);assert.ok(b.featureRuntimes.includes('router-esp32'));assert.match(b.mainC,/esp_netif_napt_enable/);assert.match(b.mainC,/clex_probe/);assert.doesNotMatch(b.mainC,/esp_eth_mac_new_w5500|esp_eth_mac_new_esp32/);assert.doesNotMatch(b.files['partitions.csv'],/ota_1/);
 p.components.find(c=>c.moduleId==='clex.hardware.router').parameters.otaEnabled=true;assert.ok(validateAssembly(p,catalog).some(i=>i.message.includes('8 МБ')));assert.throws(()=>generateFirmware(p,catalog),/8 МБ/);
});
