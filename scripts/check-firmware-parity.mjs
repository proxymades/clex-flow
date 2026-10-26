import {xgzpProject,XGZP_BOARDS} from '../tests/xgzp-fixture.js';
import {wifiProject} from '../tests/wifi-fixture.js';
import {relayProject} from '../tests/relay-fixture.js';
import {mqttProject} from '../tests/mqtt-fixture.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, timer } from '../tests/catalog-fixture.js';
import { firmwareProject } from '../tests/firmware-fixture.js';
import { networkProject } from '../tests/network-fixture.js';
import { p4Project } from '../tests/p4-fixture.js';
import {espNowProject,espNowButtonProject} from '../tests/espnow-fixture.js';
import {nanoProject} from '../tests/nano-fixture.js';
import {selectNumberProject} from '../tests/select-number-fixture.js';
import {touchButtonProject} from '../tests/touch-button-fixture.js';
import {stepperProject} from '../tests/stepper-fixture.js';
import {nanoStepperProject} from '../tests/nano-stepper-fixture.js';
import {routerProject,routerDisplayProject} from '../tests/router-fixture.js';
import {temperatureProject} from '../tests/temperature-fixture.js';
import {ESP32_BOARD,esp32GpioProject,esp32DisplayProject,esp32EspNowProject,esp32PeripheralProject,esp32RouterProject} from '../tests/esp32-firmware-fixture.js';
import { peripheralProject } from '../tests/peripheral-fixture.js';
import { createProject } from '../src/projects/model.js';
import { addHardware } from '../src/assembly/model.js';
import { addNode, connectNodes, withLogic } from '../src/logic/model.js';
import { generateFirmware, firmwareFingerprint } from '../src/firmware/generator.js';

// Exercises native validation and file generation without ESP-IDF, a device or downloads.
function mediaProject(family) {
  let project = createProject('P4 ' + family, '', 'waveshare-esp32-p4-nano', {chipRevision:'pre-v3'});
  const hardware = catalog.modules.find(module => module.id === 'clex.hardware.' + family);
  const logic = catalog.modules.find(module => module.id === (family === 'audio' ? 'clex.logic.tone' : 'clex.logic.camera-capture'));
  project = addHardware(project, hardware, catalog);
  let graph = addNode(project.logic, timer, project.components, project, catalog);
  const clock = graph.nodes.at(-1);
  graph = addNode(graph, logic, project.components, project, catalog);
  graph = connectNodes(graph, catalog, {source:clock.id,sourceHandle:'tick',target:graph.nodes.at(-1).id,targetHandle:'trigger'}, {...project,logic:graph});
  return withLogic(project, graph);
}

const cases = [
  ['esp32-gpio',esp32GpioProject(),'uart'],
  ['esp32-display-spi2',esp32DisplayProject(),'uart'],
  ['esp32-display-spi3',esp32DisplayProject(undefined,'3'),'uart'],
  ['esp32-espnow-persistence-health',esp32EspNowProject({combined:true,rememberMode:true,peerHealth:true}),'uart'],
  ['esp32-peripherals',esp32PeripheralProject(),'uart'],
  ['esp32-router-probe-display',esp32RouterProject({probe:true,display:true}),'uart'],
  ['s3-temperature',temperatureProject(),'usb'],
  ['p4-temperature',temperatureProject('waveshare-esp32-p4-nano'),'uart'],
  ['s3-select-number',selectNumberProject().project,'usb'],
  ['p4-select-number',selectNumberProject('waveshare-esp32-p4-nano').project,'uart'],
  ['nano-select-number',selectNumberProject('arduino-nano-atmega328p-ch340').project,'uart'],
  ['s3-touch-high',touchButtonProject().project,'usb'],
  ['p4-touch-low',touchButtonProject('waveshare-esp32-p4-nano','low').project,'uart'],
  ['nano-touch-low',touchButtonProject('arduino-nano-atmega328p-ch340','low').project,'uart'],
  ['s3-espnow-mac',espNowProject({zeroPeers:true}).project,'usb'],
  ['s3-espnow-receiver',espNowProject({peerHealth:true}).project,'usb'],
  ['s3-espnow-persistence',espNowProject({rememberMode:true}).project,'usb'],
  ['s3-espnow-button',espNowButtonProject().project,'usb'],
  ['nano-counter',nanoProject(),'uart'],
  ['nano-old',nanoProject({bootloader:'old'}),'uart'],
  ['nano-gpio',nanoProject({blink:true}),'uart'],
  ['nano-watch',nanoProject({watch:true}),'uart'],
  ['s3-gpio-usb', firmwareProject(), 'usb'],
  ['s3-gpio-uart', firmwareProject(), 'uart'],
  ['s3-spi-network', networkProject(), 'usb'],
  ['p4-spi-pre-v3', p4Project(), 'uart'],
  ['p4-spi-v3', p4Project(false, 'v3'), 'uart'],
  ['p4-spi-network', p4Project(true), 'uart'],
  ['p4-dsi', peripheralProject({network:false,audio:false,camera:false}), 'uart'],
  ['p4-audio', mediaProject('audio'), 'uart'],
  ['p4-camera', mediaProject('camera'), 'uart'],
  ['p4-combined', peripheralProject(), 'uart'],
];
{
 const {project,nodes}=espNowProject({receiver:false,peerHealth:true});
 project.logic=connectNodes(project.logic,catalog,{source:nodes.senderMode.id,sourceHandle:'done',target:nodes.peer.id,targetHandle:'resetStatistics'},project);
 cases.push(['s3-espnow-loss-reset',project,'usb']);
}
const root = fileURLToPath(new URL('../', import.meta.url));
cases.push(['s3-router-no-ota',routerProject({ota:false}).project,'usb'],['s3-router-display',routerDisplayProject().project,'usb']);
for(const boardId of ['waveshare-esp32-s3-eth','waveshare-esp32-p4-nano'])for(const mode of [{},{wan:'ethernet',backup:'wifi',staticWan:true},{lan:'ethernet'}])cases.push([boardId+'-router-'+(mode.lan?'lan-'+mode.lan:'wan-'+(mode.wan||'wifi')),routerProject({boardId,...mode}).project,boardId.includes('s3')?'usb':'uart']);
for(const board of [ESP32_BOARD,'waveshare-esp32-s3-eth','waveshare-esp32-p4-nano']) {
  for(const driver of ['tb6600','tmc2208','drv8825']) {
    cases.push([board+'-'+driver,stepperProject(driver,board).project,board.includes('s3')?'usb':'uart']);
  }
}
for(const driver of ['tb6600','tmc2208','drv8825'])cases.push(['nano-'+driver,nanoStepperProject({drivers:[driver],serial:true}),'uart']);
cases.push(['nano-four-steppers',nanoStepperProject({drivers:Array(4).fill('drv8825'),speed:250}),'uart']);
for(const boardId of [ESP32_BOARD,'espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano'])for(const protocol of ['3.1.1','5.0'])cases.push([boardId+'-mqtt-'+protocol,mqttProject({boardId,network:boardId.startsWith('waveshare')?'ethernet':'wifi',protocol,clients:2}).project,boardId==='waveshare-esp32-s3-eth'?'usb':'uart']);
cases.push(['s3-mqtt-auto',mqttProject({nodes:false}).project,'usb']);
for(const boardId of ['doit-esp32-devkit-v1-30pin','espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano','arduino-nano-atmega328p-ch340'])for(const activeLevel of ['low','high'])cases.push([boardId+'-relay-'+activeLevel,relayProject({boardId,activeLevel}).project,boardId==='waveshare-esp32-s3-eth'?'usb':'uart']);
for(const boardId of [ESP32_BOARD,'espressif-devkitc-1-v1-1-n8r8','waveshare-esp32-s3-eth','waveshare-esp32-p4-nano'])for(const mode of [{},{staticIp:true},{mqtt:true,logic:false}])cases.push([boardId+'-wifi-'+(mode.staticIp?'static':mode.mqtt?'mqtt':'dhcp'),wifiProject({boardId,...mode}).project,boardId==='waveshare-esp32-s3-eth'?'usb':'uart']);
for(const boardId of XGZP_BOARDS)cases.push([boardId+'-xgzp',xgzpProject(boardId).project,boardId==='waveshare-esp32-s3-eth'?'usb':'uart']);
const temporary = mkdtempSync(join(tmpdir(), 'clex-firmware-parity-'));
try {
  for (const [name, project, consoleMode] of cases) {
    const bundle = generateFirmware(project, catalog, consoleMode);
    const specification = join(temporary, name + '.json');
    writeFileSync(specification, JSON.stringify({...bundle, fingerprint:await firmwareFingerprint(bundle)}));
    const result = spawnSync('cargo', [
      'test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--offline',
      'idf::tests::generated_project_matches_frontend_assets', '--', '--ignored', '--exact',
    ], {
      cwd:root, encoding:'utf8',
      env:{...process.env,CLEX_TEST_FIRMWARE_SPEC:specification,CLEX_TEST_PROJECT_DIR:join(temporary,name)},
    });
    if (result.error || result.status !== 0) {
      process.stderr.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      throw result.error || new Error(name + ': native firmware files differ from frontend output');
    }
    assert.match(result.stdout, /1 passed/);
    console.log('PASS: ' + name);
  }
  console.log('Firmware file parity verified: ' + cases.length + ' platform configurations.');
} finally {
  rmSync(temporary, {recursive:true,force:true});
}
