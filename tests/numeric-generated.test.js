import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostC,runHostCpp} from './host-c.js';
import {numericProject,NUMERIC_BOARDS} from './numeric-fixture.js';
import {numericGraphSource} from './numeric-generated.js';
import {catalog} from './catalog-fixture.js';
import {generateFirmware} from '../src/firmware/generator.js';

for(const boardId of NUMERIC_BOARDS.filter(id=>!id.startsWith('arduino')))test('generated number-to-relay graph handles neutral, both signs, malformed messages and recovery on '+boardId,()=>{
 const {project,nodes,component}=numericProject(boardId),{source,index}=numericGraphSource(project,nodes);
 const incoming=index.get(nodes.source.id),parse=index.get(nodes.parse.id),condition=index.get(nodes.condition.id);
 const pins=['in1','in2'].map(terminal=>project.gpioAssignments.find(a=>a.componentId===component.id&&a.terminalId===terminal).gpio);
 const harness=String.raw`
#include <assert.h>
#include <string.h>
static int levels[64];
static int gpio_set_level(int pin,int level){assert(pin>=0&&pin<64);levels[pin]=level;return 0;}
#define ESP_ERROR_CHECK(call) assert((call)==0)
static char text_${incoming}[256];
`+source+String.raw`
static void check(const char *text,bool low,bool high){
 snprintf(text_${incoming},sizeof(text_${incoming}),"%s",text);node_${parse}();
 assert(relay_state_0[0]==low&&relay_state_0[1]==high);
 assert(levels[${pins[0]}]==!low&&levels[${pins[1]}]==!high);
 assert(!(relay_state_0[0]&&relay_state_0[1]));
}
int main(void){
 check("-12000.0 Па",true,false);check("12000.0 Па",false,true);
 check("-10000.0 Па",false,false);check("10000.0 Па",false,false);check("0.0 Па",false,false);
 check("-10000.25 Па",true,false);check("10000.25 Па",false,true);
 check("Нет данных",false,false);assert(!numeric_${parse}.valid&&!numeric_${condition}.valid);
 check("12000.0 Па",false,true);assert(numeric_${parse}.valid&&numeric_${condition}.valid);
 check("NaN Па",false,false);check("-1.2e4 Па",true,false);
 check("500 кПа",false,false);check("500,5 Па",false,false);
 return 0;
}
`;
 runHostC(harness,'clex-numeric-graph-');
});

test('complete generated Nano sketch runs the same relay states and clears invalid readings',()=>{
 const {project,nodes}=numericProject('arduino-nano-atmega328p-ch340');
 const source=generateFirmware(project,catalog).mainC,sorted=[...project.logic.nodes].sort((a,b)=>a.id<b.id?-1:1),index=new Map(sorted.map((n,i)=>[n.id,i]));
 const incoming=index.get(nodes.source.id),parse=index.get(nodes.parse.id);
 const main=String.raw`
#include <assert.h>
static void check(const char *text,bool low,bool high){
 snprintf(text_${incoming},sizeof(text_${incoming}),"%s",text);node_${parse}();
 assert(relay_state_0[0]==low&&relay_state_0[1]==high);
}
int main(){
 setup();assert(!relay_state_0[0]&&!relay_state_0[1]);
 check("-12000 Па",true,false);check("12000 Па",false,true);
 check("-10000 Па",false,false);check("10000 Па",false,false);
 check("bad data",false,false);check("-13000 Па",true,false);
 return 0;
}
`;
 const headers={
 'Arduino.h':String.raw`
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#define HIGH 1
#define LOW 0
#define OUTPUT 1
static uint32_t millis(){return 0;}
static void digitalWrite(int,int){}
static void pinMode(int,int){}
struct SerialAdapter {void begin(int){}void println(const char*){}};static SerialAdapter Serial;
`,
 'avr/pgmspace.h':String.raw`
#pragma once
#include <stdarg.h>
#define PSTR(s) (s)
#define strncpy_P strncpy
static int host_snprintf_P(char *out,size_t size,const char *format,...){
 char translated[80];snprintf(translated,sizeof(translated),"%s",format);
 for(size_t i=1;translated[i];i++)if(translated[i]=='S'&&translated[i-1]=='%')translated[i]='s';
 va_list args;va_start(args,format);int result=vsnprintf(out,size,translated,args);va_end(args);return result;
}
#define snprintf_P host_snprintf_P
`
 };
 // The input buffer in the actual sketch is sized for its configured text source.
 assert.ok(source.includes('clex_text_number_parse'));
 runHostCpp('#define __AVR__ 1\n'+source+main,'clex-numeric-nano-',headers);
});
