import test from 'node:test';
import {runHostC} from './host-c.js';
import {XGZP_RUNTIME} from '../src/firmware/drivers/xgzp6847d-runtime.js';

test('actual XGZP runtime handles signed data, fractional pressure, shared requests, failure and recovery without blocking',()=>{
 runHostC(String.raw`
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <assert.h>
static uint8_t bytes[2][5];
static bool busy[2],write_error,read_error;
static int writes,reads;
static bool clex_xgzp_write(uint8_t slot,uint8_t reg,uint8_t data){assert(slot<2&&reg==0x30&&data==0x0a);writes++;return !write_error;}
static bool clex_xgzp_read(uint8_t slot,uint8_t reg,uint8_t *out,uint8_t count){assert(slot<2);reads++;if(read_error)return false;if(reg==0x30){assert(count==1);*out=busy[slot]?8:0;}else{assert(reg==6&&count==5);memcpy(out,bytes[slot],count);}return true;}
`+XGZP_RUNTIME+String.raw`
static void set_data(uint8_t slot,int32_t p,int16_t t){bytes[slot][0]=(uint32_t)p>>16;bytes[slot][1]=(uint32_t)p>>8;bytes[slot][2]=p;bytes[slot][3]=(uint16_t)t>>8;bytes[slot][4]=t;}
int main(void){
 clex_xgzp_sensor_t a={.slot=0,.k=16},b={.slot=1,.k=4096};
 clex_xgzp_value_t x={0},y={0},z={0};
 clex_xgzp_request(&a,&x);clex_xgzp_request(&a,&y);
 clex_xgzp_poll(&a,90);assert(writes==0);
 clex_xgzp_poll(&a,100);assert(writes==1&&a.phase==2);
 busy[0]=true;clex_xgzp_poll(&a,105);assert(a.generation==0&&reads==1);
 set_data(0,-1600008,-2560);busy[0]=false;clex_xgzp_poll(&a,110);
 assert(a.valid&&a.pressure==-100000.5f&&a.temperature==-10.0f&&a.generation==x.generation&&a.generation==y.generation);
 clex_xgzp_snapshot(&x,&a,1);clex_xgzp_snapshot(&y,&a,4);
 assert(x.valid&&!x.waiting&&x.pressurePa==-100000.5f&&strstr(x.text,"кПа")&&strstr(x.temperatureText,"-10.00"));
 assert(fabsf(y.pressure+14.50385f)<0.001f&&strstr(y.text,"PSI"));
 set_data(1,4097,6401);clex_xgzp_request(&b,&z);clex_xgzp_poll(&b,120);clex_xgzp_poll(&b,125);
 assert(b.valid&&b.pressure>1.0f&&b.pressure<1.001f&&b.temperature>25.0f);
 // Timeout is bounded, does not stall another sensor, and invalidates old values.
 clex_xgzp_request(&a,&x);clex_xgzp_poll(&a,200);busy[0]=true;clex_xgzp_poll(&a,299);assert(a.phase==2);
 clex_xgzp_poll(&a,300);clex_xgzp_snapshot(&x,&a,0);
 assert(!x.valid&&isnan(x.pressure)&&isnan(x.pressurePa)&&isnan(x.temperature)&&strstr(x.error,"timed out")&&!strcmp(x.text,"Нет данных"));
 // A failed start and a failed status/data read have separate errors; recovery works.
 write_error=true;clex_xgzp_request(&a,&x);clex_xgzp_poll(&a,400);clex_xgzp_snapshot(&x,&a,0);assert(!x.valid&&strstr(x.error,"not responding"));write_error=false;
 read_error=true;clex_xgzp_request(&a,&x);clex_xgzp_poll(&a,500);clex_xgzp_poll(&a,505);clex_xgzp_snapshot(&x,&a,0);assert(!x.valid&&strstr(x.error,"read sensor"));read_error=false;
 busy[0]=false;set_data(0,4800000,25600);clex_xgzp_request(&a,&x);clex_xgzp_poll(&a,600);clex_xgzp_poll(&a,605);clex_xgzp_snapshot(&x,&a,0);
 assert(x.valid&&x.error[0]==0&&x.pressurePa==300000&&x.temperature==100);
 clex_xgzp_snapshot(&x,&a,2);assert(x.pressure==3&&strstr(x.text,"бар"));
 clex_xgzp_snapshot(&x,&a,3);assert(fabsf(x.pressure-2250.1848f)<0.01f);
 // Conversion timeout uses unsigned elapsed time across millis() wrap.
 clex_xgzp_request(&a,&x);clex_xgzp_poll(&a,UINT32_MAX-20U);clex_xgzp_poll(&a,5);assert(a.valid&&a.phase==0);
 set_data(0,-8388608,-32768);clex_xgzp_request(&a,&x);clex_xgzp_poll(&a,1000);clex_xgzp_poll(&a,1005);assert(a.pressure==-524288.0f&&a.temperature==-128.0f);
 return 0;
}
`,'clex-xgzp-');
});

// Execute the generated Arduino runtime with Wire/Serial adapters on the host.
// The AVR compiler is checked separately by check-xgzp-builds.mjs.
import {runHostCpp} from './host-c.js';
import {xgzpProject} from './xgzp-fixture.js';
import {catalog} from './catalog-fixture.js';
import {connectNodes,withLogic} from '../src/logic/model.js';
import {generateFirmware} from '../src/firmware/generator.js';

test('generated Nano firmware uses Wire, formats decimals, reports failures and recovers from bus errors',()=>{
 let {project,sensor,output}=xgzpProject('arduino-nano-atmega328p-ch340');
 project=withLogic(project,connectNodes(project.logic,catalog,{source:sensor.id,sourceHandle:'pressure',target:output.id,targetHandle:'number'},project));
 const source=generateFirmware(project,catalog).mainC;
 runHostCpp('#define __AVR__ 1\n#pragma GCC diagnostic ignored "-Wunused-function"\n'+source+String.raw`
#include <assert.h>
int main(){
 setup();assert(Wire.began&&Wire.clock==100000&&Wire.timeout==25000);
 for(ticks=0;ticks<1200;ticks+=5)loop();
 assert(Serial.lines==2&&Serial.last.find("300.000")!=std::string::npos&&Serial.last.find("кПа")!=std::string::npos);
 Wire.failed=true;for(;ticks<2200;ticks+=5)loop();
 assert(Serial.lines==3&&Serial.last.find("Нет данных")==0&&Serial.last.find("nan")!=std::string::npos);
 Wire.failed=false;for(;ticks<3200;ticks+=5)loop();
 assert(Serial.lines==4&&Serial.last.find("300.000")!=std::string::npos);
 return 0;
}
`,'clex-xgzp-avr-',{
 'Arduino.h':String.raw`
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <string>
static uint32_t ticks;
static uint32_t millis(){return ticks;}
static char*dtostrf(double value,signed char width,unsigned char precision,char*out){snprintf(out,24,"%*.*f",(int)width,(int)precision,value);return out;}
struct SerialAdapter{int lines=0;std::string last;void begin(int){}void println(const char*s){last=s;lines++;}};
static SerialAdapter Serial;
`,
 'Wire.h':String.raw`
#pragma once
struct WireAdapter{
 bool began=false,failed=false;uint32_t clock=0,timeout=0;uint8_t reg=0,position=0;bool reading=false;
 void begin(){began=true;}void setClock(uint32_t c){clock=c;}void setWireTimeout(uint32_t t,bool reset){timeout=t;if(!reset)abort();}
 void beginTransmission(uint8_t address){if(address!=0x6d)abort();position=0;}
 void write(uint8_t v){if(position++==0)reg=v;else if(reg!=0x30||v!=0x0a)abort();}
 uint8_t endTransmission(bool stop=true){(void)stop;return failed?2:0;}
 uint8_t requestFrom(uint8_t address,uint8_t count){if(address!=0x6d)abort();position=0;return failed?0:count;}
 uint8_t read(){if(reg==0x30)return 0;const uint8_t data[]={0x49,0x3e,0x00,0x19,0x00};return data[position++];}
};
static WireAdapter Wire;
`,
 'avr/pgmspace.h':String.raw`
#pragma once
#define PSTR(s) (s)
#define snprintf_P snprintf
#define strncpy_P strncpy
`,
 });
});
