/* global console */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {catalog} from './catalog-fixture.js';
import {relayProject} from './relay-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';
import {relayFirmware} from '../src/firmware/drivers/relay.js';
const root=resolve('.artifacts/relay-runtime');mkdirSync(join(root,'avr'),{recursive:true});
const header=String.raw`#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <assert.h>
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define GPIO_MODE_OUTPUT 1
#define GPIO_PULLUP_DISABLE 0
#define GPIO_PULLDOWN_DISABLE 0
#define GPIO_INTR_DISABLE 0
#define ESP_ERROR_CHECK(call) assert((call)==0)
static bool levels[64],enabled[64],request_value;
static int expected_inactive;
static void digitalWrite(int pin,int level){levels[pin]=level;}
static void pinMode(int pin,int mode){assert(mode==OUTPUT);assert(levels[pin]==expected_inactive);enabled[pin]=true;}
typedef struct {uint64_t pin_bit_mask;int mode,pull_up_en,pull_down_en,intr_type;} gpio_config_t;
static int gpio_set_level(int pin,int level){levels[pin]=level;return 0;}
static int gpio_config(const gpio_config_t *config){assert(config->mode==GPIO_MODE_OUTPUT);for(unsigned pin=0;pin<64;pin++)if(config->pin_bit_mask&(1ULL<<pin)){assert(levels[pin]==expected_inactive);enabled[pin]=true;}return 0;}
static uint32_t millis(void){return 0;}
#ifdef __cplusplus
struct SerialStub{void begin(int){}};
static SerialStub Serial;
#endif
`;
writeFileSync(join(root,'Arduino.h'),header);writeFileSync(join(root,'avr/pgmspace.h'),'#pragma once\n#define PSTR(x) (x)\n');
for(const avr of [false,true])for(const activeLevel of ['low','high']){
 const {project,blocks}=relayProject({boardId:avr?'arduino-nano-atmega328p-ch340':'waveshare-esp32-s3-eth',activeLevel});
 const nodes=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),index=new Map(nodes.map((n,i)=>[n.id,i]));
 const setter=blocks.find(n=>n.parameters.channel==='1'&&n.parameters.action==='set');
 let source;
 if(avr){
  const input=blocks.find(n=>n.parameters.channel==='2'&&n.parameters.action==='toggle');
  project.logic.edges=project.logic.edges.filter(edge=>edge.target!==setter.id||edge.targetHandle!=='trigger');
  project.logic.edges.push({id:'relay-runtime-trigger',source:input.id,sourceHandle:'done',target:setter.id,targetHandle:'trigger',dataType:'event'});
  project.logic.edges.push({id:'relay-runtime-data',source:input.id,sourceHandle:'state',target:setter.id,targetHandle:'value',dataType:'boolean'});
  source=generateFirmware(project,catalog).mainC;
  // Drive the real generated data path through the source node output.
  source+='\nstatic void set_request(bool value){value_'+index.get(input.id)+'=value;}\n';
 }else{
  const relay=relayFirmware(project,nodes,index,'esp-idf');
  source=header+'\n'+relay.declarations+'\n'+blocks.map(node=>'static void node_'+index.get(node.id)+'(void){\n'+relay.operations.get(node.id)({inputEdge:node=>node.id===setter.id?{}:null,dataExpression:()=> 'request_value'})+'\n}').join('\n')+'\nstatic void setup(void){\n'+relay.initialize+'\n}\nstatic void set_request(bool value){request_value=value;}\n';
 }
 const pin=channel=>project.gpioAssignments.find(a=>a.terminalId==='in'+channel).gpio;
 const call=(channel,action)=>'node_'+index.get(blocks.find(n=>n.parameters.channel===String(channel)&&n.parameters.action===action).id)+'();';
 const active=activeLevel==='low'?0:1,inactive=1-active;
 const state=(channel,on)=>`assert(relay_state_0[${channel-1}]==${on});assert(levels[${pin(channel)}]==${on?active:inactive});`;
 source+=`\nint main(void){expected_inactive=${inactive};setup();assert(enabled[${pin(1)}]&&enabled[${pin(2)}]);${state(1,false)}${state(2,false)}${call(1,'on')}${state(1,true)}${state(2,false)}${call(1,'toggle')}${state(1,false)}${call(1,'toggle')}${state(1,true)}${call(1,'off')}${state(1,false)}${call(2,'on')}${state(2,true)}${state(1,false)}set_request(true);${call(1,'set')}${state(1,true)}set_request(false);${call(1,'set')}${state(1,false)}${state(2,true)}return 0;}\n`;
 const name=(avr?'avr':'esp-idf')+'-'+activeLevel,file=join(root,name+(avr?'.cpp':'.c')),exe=join(root,name);
 writeFileSync(file,source);
 const build=spawnSync(avr?'c++':'cc',[avr?'-std=c++17':'-std=c11','-I',root,file,'-o',exe],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const result=spawnSync(exe,[],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 console.log('PASS '+name+': inactive latch before output enable, on/off/toggle, shared channel state, independent channels and dynamic boolean input');
}
