import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {catalog} from './catalog-fixture.js';
import {COUNTDOWN_BOARDS,countdownProject} from './countdown-fixture.js';
import {nodePorts,validateGraph,withLogic} from '../src/logic/model.js';
import {parseProject,serializeProject} from '../src/projects/model.js';
import {generateFirmware,firmwareFingerprint} from '../src/firmware/generator.js';
import {countdownFirmware} from '../src/firmware/drivers/countdown.js';
import {relayFirmware} from '../src/firmware/drivers/relay.js';

test('countdown uses three blocks and event connections, supports all target families and saves unchanged',async()=>{
  const module=catalog.modules.find(module=>module.id==='clex.logic.countdown');
  assert.equal(module.version,'1.0.0');
  assert.equal(catalog.modules.find(module=>module.id==='clex.logic.timer').name,'Таймер');
  for (const boardId of COUNTDOWN_BOARDS) {
    const {project,countdown}=countdownProject(boardId,{cancelOnRelease:true});
    assert.equal(project.logic.nodes.length,3);
    assert.equal(project.logic.edges.every(edge=>edge.dataType==='event'),true);
    assert.equal([...nodePorts(countdown,catalog,project).inputs,...nodePorts(countdown,catalog,project).outputs].every(port=>port.type==='event'),true);
    assert.deepEqual(validateGraph(project,catalog).filter(issue=>issue.severity==='error'||issue.code==='logic-unreachable'),[]);
    const reopened=parseProject(serializeProject(project));
    assert.deepEqual(reopened,project);
    const bundle=generateFirmware(reopened,catalog);
    assert.match(bundle.mainC,/clex_countdown_begin/);
    assert.match(bundle.mainC,/clex_countdown_expire\([^\n]+, 5000UL\)/);
    assert.match(bundle.mainC,/node_\d+_cancel\(\);/);
    assert.equal(bundle.mainC.includes('esp_timer_start_periodic'),false);
    const changed=structuredClone(reopened);
    changed.logic.nodes.find(node=>node.id===countdown.id).parameters.durationSeconds=2;
    assert.notEqual(await firmwareFingerprint(bundle),await firmwareFingerprint(generateFirmware(changed,catalog)));
  }
});

test('countdown validates duration and requires an explicit start event',()=>{
  for (const durationSeconds of [0.001,0.125,0.5,5,3600]) {
    const {project}=countdownProject(undefined,{durationSeconds});
    assert.match(generateFirmware(project,catalog).mainC,new RegExp(', '+Math.round(durationSeconds*1000)+'UL\\)'));
  }
  for (const durationSeconds of [0,-1,0.0001,3600.001,NaN,Infinity]) {
    const {project}=countdownProject(undefined,{durationSeconds});
    assert.throws(()=>generateFirmware(project,catalog),Number.isFinite(durationSeconds)?/Длительность/:/Некорректные параметры/);
  }
  const {project,countdown}=countdownProject();
  project.logic.edges=project.logic.edges.filter(edge=>edge.target!==countdown.id);
  assert.ok(validateGraph(project,catalog).some(issue=>issue.severity==='error'&&issue.code==='logic-input'&&issue.nodeId===countdown.id));
  assert.throws(()=>generateFirmware(project,catalog),/Запустить/);
  countdown.moduleVersion='2.0.0';
  assert.throws(()=>generateFirmware(withLogic(project,project.logic),catalog),/более новая версия/);
});

test('generated countdown C handlers finish once, restart, cancel, stay independent and handle clock rollover',()=>{
  const nodes=[5,0.125].map((durationSeconds,i)=>({id:'c'+i,moduleId:'clex.logic.countdown',parameters:{durationSeconds}}));
  const driver=countdownFirmware(nodes,new Map(nodes.map((node,i)=>[node.id,i])));
  const handlers=nodes.map((node,i)=>[
    `static void node_${i}_emit_started(void) { assert(countdown_${i}.active); started[${i}]++; }`,
    `static void node_${i}_emit_elapsed(void) { assert(!countdown_${i}.active); elapsed[${i}]++; }`,
    `static void node_${i}(void) {\n${driver.operations.get(node.id)}\n}`,
    driver.extraFunctions.get(node.id),
  ].join('\n')).join('\n');
  const checks=String.raw`
int main(void) {
  fake_now_ms=100000;
  poll_countdowns();
  assert(started[0]==0 && elapsed[0]==0 && !countdown_0.active);
  node_0();
  assert(started[0]==1 && elapsed[0]==0);
  fake_now_ms=104999; poll_countdowns(); assert(elapsed[0]==0);
  fake_now_ms=105000; poll_countdowns(); assert(elapsed[0]==1);
  fake_now_ms=200000; poll_countdowns(); poll_countdowns(); assert(elapsed[0]==1);

  node_0();
  fake_now_ms=202000; node_0();
  fake_now_ms=205000; poll_countdowns(); assert(elapsed[0]==1 && countdown_0.active);
  fake_now_ms=207000; poll_countdowns(); assert(elapsed[0]==2 && started[0]==3);

  node_0(); node_0_cancel(); node_0_cancel();
  fake_now_ms=212000; poll_countdowns(); assert(elapsed[0]==2 && !countdown_0.active);
  node_0();
  fake_now_ms=216999; poll_countdowns(); assert(elapsed[0]==2);
  fake_now_ms=217000; poll_countdowns(); assert(elapsed[0]==3);

  node_0(); node_1();
  fake_now_ms=217124; poll_countdowns(); assert(elapsed[1]==0);
  fake_now_ms=217125; poll_countdowns(); assert(elapsed[1]==1 && countdown_0.active);
  fake_now_ms=224000; poll_countdowns(); assert(elapsed[0]==4 && elapsed[1]==1);
  poll_countdowns(); assert(elapsed[0]==4);

  fake_now_ms=UINT32_MAX-1000; node_0();
  fake_now_ms=3998; poll_countdowns(); assert(elapsed[0]==4);
  fake_now_ms=3999; poll_countdowns(); assert(elapsed[0]==5);
  poll_countdowns(); assert(elapsed[0]==5);
  node_1(); node_1_cancel(); fake_now_ms+=1000; poll_countdowns(); assert(elapsed[1]==1);

  clex_countdown_t boundary={0};
  clex_countdown_begin(&boundary,0);
  assert(!clex_countdown_expire(&boundary,3599999,3600000));
  assert(clex_countdown_expire(&boundary,3600000,3600000));
  assert(!clex_countdown_expire(&boundary,3600001,3600000));
  clex_countdown_begin(&boundary,0);
  assert(!clex_countdown_expire(&boundary,0,1));
  assert(clex_countdown_expire(&boundary,1,1));
  puts("PASS countdown C runtime");
  return 0;
}
`;
  const directory=mkdtempSync(join(tmpdir(),'clex-countdown-'));
  try {
    const source=join(directory,'countdown.c'),binary=join(directory,'countdown');
    writeFileSync(source,'#include <stdint.h>\n#include <stdbool.h>\n#include <assert.h>\n#include <stdio.h>\n'+driver.source+
      '\nstatic unsigned started[2],elapsed[2];\nstatic uint32_t fake_now_ms;\nstatic int64_t esp_timer_get_time(void) { return (int64_t)fake_now_ms*1000; }\n'+handlers+
      '\nstatic void poll_countdowns(void) {\n'+driver.poll+'\n}\n'+checks);
    execFileSync(process.env.CLEX_HOST_CC||(process.platform==='linux'?'gcc':'clang'),['-std=c11','-Wall','-Wextra','-Werror','-Wmisleading-indentation',source,'-o',binary],{stdio:'pipe'});
    assert.match(execFileSync(binary,[],{encoding:'utf8'}),/PASS countdown C runtime/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('generated Nano countdown controls a relay, retriggers and cancels without blocking the loop',()=>{
  const directory=mkdtempSync(join(tmpdir(),'clex-countdown-avr-'));
  try {
    mkdirSync(join(directory,'avr'));
    // These two stub header names do not overlap standard library headers.
    writeFileSync(join(directory,'Arduino.h'),String.raw`#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <assert.h>
#define LOW 0
#define HIGH 1
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
static uint32_t clock_ms;
static bool pins[64],inputs[64];
static uint32_t millis(void) { return clock_ms; }
static void pinMode(int, int) {}
static void digitalWrite(int pin, int value) { pins[pin]=value; }
static int digitalRead(int pin) { return inputs[pin]; }
struct SerialStub { void begin(int) {} };
static SerialStub Serial;
`);
    writeFileSync(join(directory,'avr/pgmspace.h'),'#pragma once\n#define PSTR(value) (value)\n');
    for (const activeLevel of ['low','high']) {
      const {project,countdown,output}=countdownProject('arduino-nano-atmega328p-ch340',{activeLevel,cancelOnRelease:true});
      const nodes=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
      const ci=nodes.findIndex(node=>node.id===countdown.id),oi=nodes.findIndex(node=>node.id===output.id);
      const state=relayFirmware(project,nodes,'arduino-avr').operations.get(output.id).state;
      const checks=`
int main(void) {
  for (unsigned i=0;i<64;i++) { inputs[i]=true; }
  setup(); loop(); assert(!${state}); assert(!countdown_${ci}.active);
  node_${ci}(); assert(${state});
  clock_ms=4999; loop(); assert(${state});
  clock_ms=5000; loop(); assert(!${state});
  clock_ms=10000; node_${ci}();
  clock_ms=12000; node_${ci}();
  clock_ms=15000; loop(); assert(${state});
  clock_ms=17000; loop(); assert(!${state});
  node_${ci}(); node_${ci}_cancel();
  clock_ms=22000; loop(); assert(${state}); assert(!countdown_${ci}.active);
  node_${oi}_off(); assert(!${state});
  clock_ms=UINT32_MAX-1000; node_${ci}();
  clock_ms=3998; loop(); assert(${state});
  clock_ms=3999; loop(); assert(!${state});
  return 0;
}
`;
      const source=join(directory,activeLevel+'.cpp'),binary=join(directory,activeLevel);
      writeFileSync(source,generateFirmware(project,catalog).mainC+checks);
      execFileSync(process.env.CLEX_HOST_CXX||(process.platform==='win32'?'clang++':'c++'),['-std=c++17','-Wall','-Wextra','-Werror','-Wmisleading-indentation','-I',directory,source,'-o',binary],{stdio:'pipe'});
      execFileSync(binary,[],{stdio:'pipe'});
    }
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
