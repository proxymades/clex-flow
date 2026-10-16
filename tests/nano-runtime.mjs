/* global console */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {nanoProject,nano} from './nano-fixture.js';
import {catalog} from './catalog-fixture.js';
import {touchButtonProject} from './touch-button-fixture.js';
import {createProject} from '../src/projects/model.js';
import {addHardware,connectTerminal} from '../src/assembly/model.js';
import{addNode,connectNodes,withLogic}from '../src/logic/model.js';
import {generateFirmware} from '../src/firmware/generator.js';
const root=resolve('.artifacts/nano-runtime');mkdirSync(root+'/avr',{recursive:true});
writeFileSync(root+'/Arduino.h',`#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string>
#include <vector>
#include <assert.h>
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define LOW 0
#define HIGH 1
static uint32_t clock_ms;
static bool pins[20],inputs[20];
static int modes[20];
static uint32_t millis(){return clock_ms;}
static void pinMode(int p,int mode){modes[p]=mode;}
static void digitalWrite(int p,int v){pins[p]=v;}
static int digitalRead(int p){return inputs[p];}
struct SerialStub {std::vector<std::string> lines;void begin(int){}void println(const char*s){lines.emplace_back(s);}};
static SerialStub Serial;
`);
writeFileSync(root+'/avr/pgmspace.h',`#pragma once
#include <stdarg.h>
#define PSTR(x) (x)
static int snprintf_P(char* out,size_t n,const char* fmt,...){std::string f(fmt);for(size_t i=0;(i=f.find("%S",i))!=std::string::npos;)f.replace(i,2,"%s");va_list ap;va_start(ap,fmt);int r=vsnprintf(out,n,f.c_str(),ap);va_end(ap);return r;}
`);
function run(name,p,checks){const source=generateFirmware(p,catalog).mainC;writeFileSync(root+'/'+name+'.cpp',source+'\nint main(){'+checks+'}\n');const binary=root+'/'+name;const build=spawnSync('c++',['-std=c++17','-I',root,root+'/'+name+'.cpp','-o',binary],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);const result=spawnSync(binary,[],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);rmSync(binary);console.log('PASS: '+name);}
const index=(p,id)=>[...p.logic.nodes].sort((a,b)=>a.id<b.id?-1:1).findIndex(n=>n.moduleId===id);
let p=nanoProject();const count=index(p,'clex.logic.counter');
run('counter-events',p,`setup();clock_ms=999;loop();assert(Serial.lines.empty());clock_ms=1000;loop();assert(Serial.lines.back()=="Счетчик: 1");clock_ms=2000;loop();assert(Serial.lines.back()=="Счетчик: 2");value_${count}=INT32_MAX;clock_ms=3000;loop();assert(value_${count}==INT32_MAX);node_${count}_reset();assert(value_${count}==0);`);
run('millis-rollover',p,'clock_ms=UINT32_MAX-499;setup();clock_ms=499;loop();assert(Serial.lines.empty());clock_ms=500;loop();assert(Serial.lines.back()=="Счетчик: 1");');
p=nanoProject({watch:true});p.logic.nodes.find(n=>n.moduleId==='clex.logic.stopwatch').parameters.autoStart=false;const watch=index(p,'clex.logic.stopwatch');
run('watch-start-pause-reset',p,`setup();loop();assert(Serial.lines.back()=="00:00:00");node_${watch}();clock_ms=1250;loop();assert(Serial.lines.back()=="00:00:01");clock_ms=1599;node_${watch}_pause();clock_ms=2599;loop();assert(Serial.lines.back()=="00:00:01");node_${watch}();clock_ms=3000;loop();assert(Serial.lines.back()=="00:00:02");node_${watch}_reset();assert(Serial.lines.back()=="00:00:00");assert(watch_${watch}.running);clock_ms=3603000;loop();assert(Serial.lines.back()=="01:00:00");`);
p=nanoProject({blink:true});run('gpio-toggle',p,'setup();assert(modes[13]==OUTPUT);assert(!pins[13]);clock_ms=1000;loop();assert(pins[13]);clock_ms=2000;loop();assert(!pins[13]);');
p=createProject('Nano button','',nano.id);for(const id of ['clex.hardware.led','clex.hardware.button'])p=addHardware(p,catalog.modules.find(m=>m.id===id),catalog);
const led=p.components.find(c=>c.moduleId==='clex.hardware.led'),button=p.components.find(c=>c.moduleId==='clex.hardware.button');
for(const[c,port,pin]of [[led,'anode','D13'],[led,'cathode','GND-R'],[button,'signal','D2'],[button,'ground','GND-L']])p=connectTerminal(p,catalog,c.id,port,pin);
let graph=p.logic;for(const id of ['clex.logic.timer','clex.logic.gpio-read','clex.logic.gpio-set'])graph=addNode(graph,catalog.modules.find(m=>m.id===id),p.components,p,catalog);
const[timer,read,set]=graph.nodes;timer.parameters.intervalMs=100;read.parameters.componentId=button.id;set.parameters.componentId=led.id;
for(const[s,sh,t,th]of [[timer,'tick',read,'trigger'],[read,'done',set,'trigger'],[read,'level',set,'value']])graph=connectNodes(graph,catalog,{source:s.id,sourceHandle:sh,target:t.id,targetHandle:th},{...p,logic:graph});
p=withLogic(p,graph);run('button-debounce-and-gpio-set',p,'inputs[2]=true;setup();clock_ms=100;loop();assert(pins[13]);inputs[2]=false;clock_ms=200;loop();assert(pins[13]);clock_ms=220;loop();assert(pins[13]);clock_ms=300;loop();assert(!pins[13]);');
graph={nodes:[],edges:[],viewport:p.logic.viewport};for(const id of ['clex.logic.gpio-edge','clex.logic.gpio-toggle'])graph=addNode(graph,catalog.modules.find(m=>m.id===id),p.components,p,catalog);
const[edge,toggle]=graph.nodes;edge.parameters.componentId=button.id;toggle.parameters.componentId=led.id;graph=connectNodes(graph,catalog,{source:edge.id,sourceHandle:'falling',target:toggle.id,targetHandle:'trigger'},{...p,logic:graph});p=withLogic(p,graph);
run('button-single-edge',p,'inputs[2]=true;setup();loop();assert(!pins[13]);inputs[2]=false;clock_ms=100;loop();clock_ms=120;loop();assert(!pins[13]);clock_ms=130;loop();assert(pins[13]);clock_ms=1000;loop();assert(pins[13]);inputs[2]=true;clock_ms=1100;loop();clock_ms=1130;loop();assert(pins[13]);inputs[2]=false;clock_ms=1200;loop();clock_ms=1230;loop();assert(!pins[13]);');

for(const activeLevel of ['high','low']){
 const {project,component,nodes}=touchButtonProject(nano.id,activeLevel),pin=project.gpioAssignments.find(a=>a.componentId===component.id).gpio;
 const sorted=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),read=sorted.findIndex(n=>n.id===nodes.read.id),count=sorted.findIndex(n=>n.id===nodes.counter.id);
 const active=activeLevel==='high'?'true':'false',inactive=activeLevel==='high'?'false':'true';
 run('touch-'+activeLevel,project,`inputs[${pin}]=${inactive};setup();assert(modes[${pin}]==INPUT);loop();assert(Serial.lines.empty());node_${read}();assert(!value_${read});inputs[${pin}]=${active};clock_ms=100;loop();clock_ms=120;inputs[${pin}]=${inactive};loop();clock_ms=140;inputs[${pin}]=${active};loop();clock_ms=169;loop();assert(value_${count}==0);clock_ms=170;loop();assert(value_${count}==1);assert(value_${read});assert(Serial.lines.back()=="Касаний: 1");clock_ms=1000;loop();assert(value_${count}==1);clock_ms=1100;inputs[${pin}]=${inactive};loop();clock_ms=1130;loop();assert(!value_${read});assert(Serial.lines.back()=="Сенсор выключен");clock_ms=1200;inputs[${pin}]=${active};loop();clock_ms=1230;loop();assert(value_${count}==2);`);
}
