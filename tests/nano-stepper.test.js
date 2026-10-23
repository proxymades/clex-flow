import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from './catalog-fixture.js';
import { nano } from './nano-fixture.js';
import { nanoStepperProject } from './nano-stepper-fixture.js';
import { runHostCpp } from './host-c.js';
import { moduleSupportsBoard } from '../src/catalog/compatibility.js';
import { addHardware, connectionProblem, validateAssembly } from '../src/assembly/model.js';
import { validateGraph, addNode, withLogic } from '../src/logic/model.js';
import { resourceClaims } from '../src/hardware/resources.js';
import { generateFirmware } from '../src/firmware/generator.js';
import { parseProject, serializeProject } from '../src/projects/model.js';

test('Nano supports each STEP/DIR driver, both bootloaders, saved wiring and Timer1 code without ESP-IDF', () => {
 for (const driver of ['tb6600', 'tmc2208', 'drv8825']) for (const bootloader of ['standard', 'old']) {
  const project = nanoStepperProject({ drivers: [driver], bootloader, serial: true });
  assert.equal(moduleSupportsBoard(catalog.modules.find(module => module.id === 'clex.hardware.' + driver), nano), true);
  assert.deepEqual([...validateAssembly(project, catalog), ...validateGraph(project, catalog)].filter(issue => issue.severity === 'error'), []);
  const bundle = generateFirmware(project, catalog);
  assert.equal(bundle.boardRevision, bootloader);
  assert.match(bundle.mainC, /ISR\(TIMER1_COMPA_vect\)/);
  assert.match(bundle.mainC, /ATOMIC_BLOCK\(ATOMIC_RESTORESTATE\)/);
  assert.match(bundle.mainC, /PSTR\("%S %ld"\)/);
  assert.doesNotMatch(bundle.mainC, /gptimer|freertos|esp_timer|@[A-Z_]+@|TCCR0|TIMSK0/);
  assert.deepEqual(generateFirmware(parseProject(serializeProject(project)), catalog), bundle);
 }
});

test('Nano motion shares one Timer1, rejects a fifth driver, occupied Timer1 and excessive per-motor rate', () => {
 let project = nanoStepperProject({ drivers: Array(4).fill('drv8825'), speed: 250 });
 assert.deepEqual(validateAssembly(project, catalog).filter(issue => issue.severity === 'error'), []);
 assert.equal(resourceClaims(project, catalog).filter(claim => claim.key === 'timer:1').length, 1);
 assert.match(generateFirmware(project, catalog).mainC, /clex_sp_drivers\[4\]/);
 const blocked = { ...catalog, boards: catalog.boards.map(board => board.id === nano.id ? { ...board, peripherals: [{ id: 'occupied-timer', name: 'Другой Timer1', occupancySetting: 'timer1', resources: [{ key: 'timer:1' }] }] } : board) };
 project.boardSettings.timer1 = 'connected';
 assert.ok(validateAssembly(project, blocked).some(issue => issue.code === 'hardware-resource'));
 assert.throws(() => generateFirmware(project, blocked), /Timer1/);
 delete project.boardSettings.timer1;
 project.logic.nodes.find(node => node.moduleId === 'clex.logic.stepper').parameters.speed = 501;
 assert.ok(validateGraph(project, catalog).some(issue => issue.code === 'stepper-logic' && issue.message.includes('500')));
 project = addHardware(project, catalog.modules.find(module => module.id === 'clex.hardware.drv8825'), catalog);
 assert.ok(validateAssembly(project, catalog).some(issue => issue.code === 'stepper-count'));
});

test('TMC2208 VIO follows controller logic voltage, and idle drivers generate without starting motion', () => {
 const project = nanoStepperProject({ drivers: ['tmc2208'] }), driver = project.components.find(component => component.moduleId === 'clex.hardware.tmc2208');
 assert.equal(connectionProblem(project, catalog, driver.id, 'vio', '5V'), null);
 assert.ok(connectionProblem(project, catalog, driver.id, 'vio', '3V3'));
 project.logic.nodes = []; project.logic.edges = [];
 const bundle = generateFirmware(project, catalog);
 assert.match(bundle.mainC, /clex_sp_initialize\(\);/);
 assert.doesNotMatch(bundle.mainC, /clex_sp_start\(0,/);
});

const headers = {
 'Arduino.h': String.raw`#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <assert.h>
#define F_CPU 16000000UL
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define LOW 0
#define HIGH 1
#define _BV(b) (1U<<(b))
enum { OCF1A=1, OCIE1A=1, CS11=1 };
static uint8_t TCCR1A,TCCR1B,TIMSK1,TIFR1;
static uint16_t TCNT1,OCR1A;
static uint32_t clock_us,rising[20],rose_at[20];
static bool pins[20],step_pins[20],in_isr;
static int modes[20];
static uint32_t millis(){return clock_us/1000;}
static void pinMode(int pin,int mode){modes[pin]=mode;}
static void digitalWrite(int pin,int value){
 assert(pin>=0&&pin<20);
 if(value&&!pins[pin]){rising[pin]++;rose_at[pin]=clock_us;}
 if(!value&&pins[pin]&&step_pins[pin])assert(clock_us-rose_at[pin]>=5);
 pins[pin]=value;
}
struct SerialStub {
 char last[256];unsigned lines;
 void begin(int){}
 void println(const char*s){assert(!in_isr);snprintf(last,sizeof(last),"%s",s);lines++;}
};
static SerialStub Serial;
`,
 'avr/pgmspace.h': String.raw`#pragma once
#include <stdarg.h>
#define PSTR(x) (x)
static inline int snprintf_P(char*out,size_t size,const char*format,...){
 char local[64];snprintf(local,sizeof(local),"%s",format);for(char*p=local;*p;p++)if(*p=='S')*p='s';
 va_list args;va_start(args,format);int result=vsnprintf(out,size,local,args);va_end(args);return result;
}
`,
 'avr/interrupt.h': '#pragma once\n#define ISR(vector) static void vector(void)\n',
 'util/atomic.h': '#pragma once\n#define ATOMIC_RESTORESTATE 0\n#define ATOMIC_BLOCK(mode) for(bool atomic_once=true;atomic_once;atomic_once=false)\n',
};
const clock = String.raw`
static void advance(uint32_t us){
 while(us){
  if(!TCCR1B||!TIMSK1){clock_us+=us;return;}
  uint32_t until=(uint16_t)(OCR1A-TCNT1)/2;
  if(until>us){TCNT1+=(uint16_t)(us*2);clock_us+=us;return;}
  TCNT1=OCR1A;clock_us+=until;us-=until;
  in_isr=true;TIMER1_COMPA_vect();in_isr=false;
 }
}
`;

test('generated Nano motion emits exact pulses with nonblocking Serial, reverse, safe stop/release and late interrupts', () => {
 let project = nanoStepperProject({ serial: true });
 const graph = addNode(project.logic, catalog.modules.find(module => module.id === 'clex.logic.stopwatch'), project.components, project, catalog);
 project = withLogic(project, graph);
 const nodes = [...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1), index = nodes.findIndex(node => node.moduleId === 'clex.logic.stepper');
 const watch=nodes.findIndex(node=>node.moduleId==='clex.logic.stopwatch');
 const source = generateFirmware(project, catalog).mainC + clock + `
int main(){
 setup();node_${watch}();node_${watch}_pause();node_${watch}_reset();node_${watch}();loop();const clex_sp_config_t*c=&clex_sp_configs[0];step_pins[c->step]=true;
 assert(clex_sp_drivers[0].core.ready&&!clex_sp_drivers[0].core.moving&&!TCCR1B);
 assert(!pins[c->step]&&pins[c->enable]!=c->enable_high);
 node_${index}();assert(clex_sp_drivers[0].core.moving&&pins[c->enable]==c->enable_high);
 while(clex_sp_drivers[0].core.moving){advance(100);loop();}
 assert(rising[c->step]==200&&stepper_value_${index}.position==200&&!pins[c->step]);
 assert(stepper_value_${index}.emitted==200&&Serial.lines>1&&!TIMSK1);
 assert(clex_sp_start(0,${index},0,true,400,0)==SP_OK);
 advance(2500);assert(pins[c->step]);uint32_t count=rising[c->step];
 node_${index}_release();assert(pins[c->step]&&pins[c->enable]==c->enable_high);
 advance(10);loop();assert(!pins[c->step]&&pins[c->enable]!=c->enable_high&&!clex_sp_drivers[0].core.moving);
 assert(stepper_value_${index}.position==199&&rising[c->step]==count);
 assert(clex_sp_start(0,${index},2,false,500,0)==SP_OK);
 // A delayed interrupt emits a single edge and still schedules a full pulse width.
 clock_us+=(OCR1A+2000)/2;TCNT1=OCR1A+2000;in_isr=true;TIMER1_COMPA_vect();in_isr=false;
 assert(rising[c->step]==count+1&&pins[c->step]);node_${index}_stop();advance(10);loop();
 assert(!pins[c->step]&&pins[c->enable]==c->enable_high&&!clex_sp_drivers[0].core.moving);
 node_${index}_release();assert(pins[c->enable]!=c->enable_high);
 clex_sp_drivers[0].core.position=INT32_MAX;
 assert(clex_sp_start(0,${index},1,false,400,0)==SP_POSITION_LIMIT);
 return 0;
}
`;
 runHostCpp(source, 'clex-nano-motion-', headers);
});

test('four Nano motors share Timer1 with independent deadlines and reject excessive simultaneous frequency', () => {
 const project = nanoStepperProject({ drivers: Array(4).fill('drv8825'), speed: 250 });
 const nodes=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1);
 const controls=nodes.flatMap((node,index)=>node.moduleId==='clex.logic.stepper'?['node_'+index+'_stop();','node_'+index+'_release();']:[]).join('');
 const source = generateFirmware(project, catalog).mainC + clock + String.raw`
int main(){
 setup();loop();for(unsigned id=0;id<4;id++)step_pins[clex_sp_configs[id].step]=true;${controls}
 assert(clex_sp_start(0,0,10,false,500,0)==SP_OK);
 advance(1000);assert(TCNT1==2000);
 assert(clex_sp_start(1,1,20,true,500,0)==SP_OK);
 assert(clex_sp_drivers[0].remaining==1000);
 assert(clex_sp_start(2,2,10,false,1,0)==SP_RATE_LIMIT);
 while(clex_sp_drivers[0].core.moving||clex_sp_drivers[1].core.moving){advance(100);loop();}
 assert(clex_sp_drivers[0].core.position==10&&clex_sp_drivers[1].core.position==-20);
 for(unsigned id=0;id<4;id++)assert(clex_sp_start(id,id,5,id%2,250,1000)==SP_OK);
 bool moving=true;while(moving){advance(100);loop();moving=false;for(unsigned id=0;id<4;id++)moving|=clex_sp_drivers[id].core.moving;}
 for(unsigned id=0;id<4;id++)assert(clex_sp_drivers[id].core.emitted==5);
 assert(!TIMSK1);return 0;
}
`;
 runHostCpp(source, 'clex-nano-multi-motion-', headers);
});
