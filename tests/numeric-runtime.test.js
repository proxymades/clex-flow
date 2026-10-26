import test from 'node:test';
import {runHostC,runHostCpp} from './host-c.js';
import {NUMERIC_RUNTIME} from '../src/firmware/drivers/numeric-runtime.js';

const cases=String.raw`
#include <assert.h>
static void parse_ok(clex_text_number_t *out,const char *text,const char *prefix,const char *suffix,unsigned separator,double expected) {
#ifdef __AVR__
 expected=(float)expected;
#endif
 clex_text_number_parse(out,text,prefix,suffix,separator);assert(out->valid);assert(out->value==expected);assert(!out->error[0]);
}
static void parse_bad(clex_text_number_t *out,const char *text,const char *prefix,const char *suffix,unsigned separator) {
 clex_text_number_parse(out,text,prefix,suffix,separator);assert(!out->valid&&isnan(out->value)&&out->error[0]);
}
static void check_range(clex_number_condition_t *out,double value,int expected) {
 clex_number_evaluate(out,value,true,0,0,-10000,10000,true,true,0);
 assert(out->valid);assert((int)out->below+(int)out->inside+(int)out->above==1);
 assert(expected<0?out->below:expected>0?out->above:out->inside);
}
int main(void) {
 clex_text_number_t parsed={.value=0,.valid=false,.error=""};clex_number_condition_t condition={.value=0,.valid=false,.result=false,.below=false,.inside=false,.above=false,.error=""};
 parse_ok(&parsed,"  -10000.25 Па  ","","Па",0,-10000.25);
 parse_ok(&parsed,"P= +12,5 kPa","P=","kPa",2,12.5);
 parse_ok(&parsed,"\t-.5e+2\r\n","","",1,-50);
 parse_ok(&parsed,"0","","",0,0);parse_ok(&parsed,"1.","","",1,1);
 parse_ok(&parsed,".25","","",1,0.25);parse_ok(&parsed,"-2E-2","","",1,-0.02);
 const char *bad[]={""," ","NaN","inf","Infinity","0x10","1e","1e+","--1","1.2.3","12 words","1,000.5","Нет данных","1e999","1e-999","+","-","."};
 for(unsigned i=0;i<sizeof(bad)/sizeof(bad[0]);i++)parse_bad(&parsed,bad[i],"","",0);
 parse_bad(&parsed,"1,5","","",1);parse_bad(&parsed,"1.5","","",2);
 parse_bad(&parsed,"25 Па","","кПа",0);parse_bad(&parsed,"A=2","P=","",0);
 char huge[100];memset(huge,'9',sizeof(huge)-1);huge[sizeof(huge)-1]=0;parse_bad(&parsed,huge,"","",0);
 parse_bad(&parsed,NULL,"","",0);
 parse_ok(&parsed,"12000.0 Па","","Па",0,12000);
 check_range(&condition,-12000,-1);check_range(&condition,-10000,0);check_range(&condition,0,0);check_range(&condition,10000,0);check_range(&condition,12000,1);
 check_range(&condition,-10000.25,-1);check_range(&condition,10000.25,1);
 clex_number_evaluate(&condition,-10000,true,0,0,-10000,10000,false,false,0);assert(condition.valid&&condition.below);
 clex_number_evaluate(&condition,10000,true,0,0,-10000,10000,false,false,0);assert(condition.valid&&condition.above);
 clex_number_evaluate(&condition,5,true,0,0,5,5,true,true,0);assert(condition.valid&&condition.inside);
 const double invalid[]={NAN,INFINITY,-INFINITY};
 for(unsigned i=0;i<3;i++){clex_number_evaluate(&condition,invalid[i],true,0,0,-1,1,true,true,0);assert(!condition.valid&&!condition.below&&!condition.above&&!condition.inside&&!condition.result&&isnan(condition.value)&&condition.error[0]);}
 clex_number_evaluate(&condition,5,true,0,0,10,-10,true,true,0);assert(!condition.valid);
 clex_number_evaluate(&condition,5,true,0,0,5,5,false,true,0);assert(!condition.valid);
 const bool expected[]={true,true,false,true,false,false};
 for(unsigned op=0;op<6;op++){clex_number_evaluate(&condition,-2,false,op,3,0,0,true,true,0);assert(condition.valid&&condition.result==expected[op]);}
 clex_number_evaluate(&condition,3.05,false,2,3,0,0,true,true,0.1);assert(condition.valid&&condition.result);
 clex_number_evaluate(&condition,3.05,false,3,3,0,0,true,true,0.1);assert(condition.valid&&!condition.result);
 clex_number_evaluate(&condition,3,false,2,3,0,0,true,true,0);assert(condition.valid&&condition.result);
 clex_number_evaluate(&condition,3,false,5,NAN,0,0,true,true,0);assert(!condition.valid&&!condition.result);
 check_range(&condition,12000,1);assert(!condition.error[0]);
#ifdef __AVR__
 parse_bad(&parsed,"1e39","","",0);parse_bad(&parsed,"1e-50","","",0);
#endif
 return 0;
}
`;
test('numeric runtime parses explicit text formats, rejects invalid data and evaluates all boundaries',()=>{
 runHostC(NUMERIC_RUNTIME+cases,'clex-numeric-');
});
test('numeric runtime compiles as AVR C++ with explicit initializers and bounded float range',()=>{
 runHostCpp('#define __AVR__ 1\n'+NUMERIC_RUNTIME+cases,'clex-numeric-avr-',{'avr/pgmspace.h':'#pragma once\n#define PSTR(s) (s)\n#define strncpy_P strncpy\n'});
});
