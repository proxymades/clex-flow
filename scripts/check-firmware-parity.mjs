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
  ['s3-espnow-mac',espNowProject({zeroPeers:true}).project,'usb'],
  ['s3-espnow-receiver',espNowProject().project,'usb'],
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
const root = fileURLToPath(new URL('../', import.meta.url));
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
