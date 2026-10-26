// Bounded parsing and numerical conditions shared by ESP-IDF and Arduino AVR.
export const NUMERIC_RUNTIME=String.raw`
#include <math.h>
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <float.h>
typedef struct { double value; bool valid; char error[96]; } clex_text_number_t;
typedef struct {
 double value;
 bool valid, result, below, inside, above;
 char error[96];
} clex_number_condition_t;
#ifdef __AVR__
#include <avr/pgmspace.h>
#define CLEX_NUM_ERROR(dst,literal) strncpy_P(dst,PSTR(literal),sizeof(dst))
#else
#define CLEX_NUM_ERROR(dst,literal) snprintf(dst,sizeof(dst),"%s",literal)
#endif
static bool __attribute__((unused)) clex_num_space(char c) {
 return c==' '||c=='\t'||c=='\r'||c=='\n'||c=='\v'||c=='\f';
}
static bool __attribute__((unused)) clex_num_digit(char c) { return c>='0'&&c<='9'; }
static void __attribute__((unused)) clex_text_number_parse(clex_text_number_t *out,const char *text,const char *prefix,const char *suffix,unsigned separator) {
 out->value=NAN;out->valid=false;out->error[0]=0;
 if(!text){CLEX_NUM_ERROR(out->error,"Нет входного текста");return;}
 size_t length=0;
 while(length<=8192U&&text[length])length++;
 if(length>8192U){CLEX_NUM_ERROR(out->error,"Входной текст слишком длинный");return;}
 const char *begin=text,*end=text+length;
 while(begin<end&&clex_num_space(*begin))begin++;
 while(end>begin&&clex_num_space(end[-1]))end--;
 size_t pre=strlen(prefix),post=strlen(suffix);
 if((size_t)(end-begin)<pre||memcmp(begin,prefix,pre)){CLEX_NUM_ERROR(out->error,"Не совпадает подпись перед числом");return;}
 begin+=pre;
 if((size_t)(end-begin)<post||memcmp(end-post,suffix,post)){CLEX_NUM_ERROR(out->error,"Не совпадает подпись после числа");return;}
 end-=post;
 while(begin<end&&clex_num_space(*begin))begin++;
 while(end>begin&&clex_num_space(end[-1]))end--;
 if(begin==end){CLEX_NUM_ERROR(out->error,"Пустое число");return;}
 if((size_t)(end-begin)>=80U){CLEX_NUM_ERROR(out->error,"Число слишком длинное");return;}
 char number[80];size_t used=0;const char *cursor=begin;
 if(*cursor=='+'||*cursor=='-')number[used++]=*cursor++;
 unsigned digits=0;
 while(cursor<end&&clex_num_digit(*cursor)){number[used++]=*cursor++;digits++;}
 if(cursor<end&&((*cursor=='.'&&separator!=2U)||(*cursor==','&&separator!=1U))){
  number[used++]='.';cursor++;
  while(cursor<end&&clex_num_digit(*cursor)){number[used++]=*cursor++;digits++;}
 }
 if(!digits){CLEX_NUM_ERROR(out->error,"Некорректное число");return;}
 if(cursor<end&&(*cursor=='e'||*cursor=='E')){
  number[used++]=*cursor++;
  if(cursor<end&&(*cursor=='+'||*cursor=='-'))number[used++]=*cursor++;
  unsigned exponent=0;
  while(cursor<end&&clex_num_digit(*cursor)){number[used++]=*cursor++;exponent++;}
  if(!exponent){CLEX_NUM_ERROR(out->error,"Некорректная экспонента");return;}
 }
 if(cursor!=end){CLEX_NUM_ERROR(out->error,"Лишние символы в числе");return;}
 number[used]=0;errno=0;char *tail=NULL;double value=strtod(number,&tail);
 if(errno==ERANGE||!isfinite(value)||!tail||*tail){CLEX_NUM_ERROR(out->error,"Число вне допустимого диапазона");return;}
#ifdef __AVR__
 if(fabs(value)>FLT_MAX||(value!=0&&(float)value==0)){CLEX_NUM_ERROR(out->error,"Число вне диапазона Arduino AVR");return;}
 value=(float)value;
#endif
 out->value=value;out->valid=true;
}
static void __attribute__((unused)) clex_number_evaluate(clex_number_condition_t *out,double value,bool range,unsigned operation,double reference,double lower,double upper,bool include_lower,bool include_upper,double tolerance) {
 out->value=NAN;out->valid=false;out->result=false;out->below=false;out->inside=false;out->above=false;out->error[0]=0;
 if(!isfinite(value)){CLEX_NUM_ERROR(out->error,"Входное число некорректно");return;}
 if(range){
  if(!isfinite(lower)||!isfinite(upper)||lower>upper||(lower==upper&&(!include_lower||!include_upper))){CLEX_NUM_ERROR(out->error,"Некорректные границы диапазона");return;}
  out->below=value<lower||(!include_lower&&value==lower);
  out->above=value>upper||(!include_upper&&value==upper);
  out->inside=!out->below&&!out->above;out->result=out->inside;
 }else{
  if(!isfinite(reference)||!isfinite(tolerance)||tolerance<0||operation>5U){CLEX_NUM_ERROR(out->error,"Некорректные параметры сравнения");return;}
  switch(operation){
   case 0:out->result=value<reference;break;
   case 1:out->result=value<=reference;break;
   case 2:out->result=fabs(value-reference)<=tolerance;break;
   case 3:out->result=fabs(value-reference)>tolerance;break;
   case 4:out->result=value>=reference;break;
   case 5:out->result=value>reference;break;
  }
 }
 out->value=value;out->valid=true;
}
#undef CLEX_NUM_ERROR
`;
