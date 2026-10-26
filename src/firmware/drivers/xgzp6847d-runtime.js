// XGZP6847D (non-C, 0x6D), independently implemented from CFSensor V2.8.
// Conversions advance from the graph loop; no busy wait or delay in node actions.
export const XGZP_RUNTIME = String.raw`
typedef struct {
  uint8_t slot, phase, error;
  uint16_t k;
  uint32_t started, generation;
  float pressure, temperature;
  bool valid;
} clex_xgzp_sensor_t;
typedef struct {
  float pressure, pressurePa, temperature;
  bool valid, waiting, scheduled;
  uint32_t generation, due;
  char text[32], temperatureText[32], error[48];
} clex_xgzp_value_t;
static void clex_xgzp_finish(clex_xgzp_sensor_t *s, uint8_t error, const uint8_t *bytes) {
  s->error=error; s->valid=error==0; s->phase=0; s->generation++;
  s->pressure=NAN; s->temperature=NAN;
  if (s->valid) {
    int32_t p=(int32_t)((uint32_t)bytes[0]*65536UL+(uint32_t)bytes[1]*256UL+bytes[2]);
    if(p & 0x800000L)p-=0x1000000L;
    int32_t t=(int32_t)((uint16_t)bytes[3]*256U+bytes[4]);
    if(t & 0x8000L)t-=0x10000L;
    s->pressure=(float)p/(float)s->k;
    s->temperature=(float)t/256.0f;
  }
}
static void clex_xgzp_request(clex_xgzp_sensor_t *s, clex_xgzp_value_t *value) {
  value->waiting=true; value->generation=s->generation+1U;
  if(!s->phase)s->phase=1;
}
static void clex_xgzp_poll(clex_xgzp_sensor_t *s, uint32_t now) {
  if(!s->phase || (now<100U && !s->generation))return;
  if(s->phase==1) {
    if(!clex_xgzp_write(s->slot,0x30,0x0a)){clex_xgzp_finish(s,1,NULL);return;}
    s->started=now; s->phase=2; return;
  }
  if((uint32_t)(now-s->started)>=100U){clex_xgzp_finish(s,3,NULL);return;}
  uint8_t status;
  if(!clex_xgzp_read(s->slot,0x30,&status,1)){clex_xgzp_finish(s,2,NULL);return;}
  if(status & 0x08)return;
  uint8_t bytes[5];
  if(!clex_xgzp_read(s->slot,0x06,bytes,sizeof(bytes))){clex_xgzp_finish(s,2,NULL);return;}
  clex_xgzp_finish(s,0,bytes);
}
#ifdef __AVR__
#define CLEX_XGZP_COPY(dst,literal) strncpy_P(dst,PSTR(literal),sizeof(dst))
#else
#define CLEX_XGZP_COPY(dst,literal) snprintf(dst,sizeof(dst),"%s",literal)
#endif
static void clex_xgzp_number(char *out, size_t size, float number, uint8_t decimals) {
#ifdef __AVR__
  char buffer[24]; dtostrf(number,0,decimals,buffer); snprintf(out,size,"%s",buffer);
#else
  snprintf(out,size,"%.*f",(int)decimals,(double)number);
#endif
}
static void clex_xgzp_snapshot(clex_xgzp_value_t *v, const clex_xgzp_sensor_t *s, uint8_t unit) {
  v->waiting=false; v->valid=s->valid; v->pressurePa=s->pressure; v->temperature=s->temperature;
  v->pressure=s->pressure/(unit==1?1000.0f:unit==2?100000.0f:unit==3?133.322387415f:unit==4?6894.757293168f:1.0f);
  v->error[0]=0;
  if(!v->valid) {
    CLEX_XGZP_COPY(v->text,"Нет данных"); CLEX_XGZP_COPY(v->temperatureText,"Нет данных");
    if(s->error==1){CLEX_XGZP_COPY(v->error,"I2C: sensor not responding (0x6D)");}
    else if(s->error==2){CLEX_XGZP_COPY(v->error,"I2C: failed to read sensor");}
    else {CLEX_XGZP_COPY(v->error,"Sensor conversion timed out");}
    return;
  }
  char number[24],suffix[24];
  clex_xgzp_number(number,sizeof(number),v->pressure,unit==2?5:unit==1?3:unit==3?2:1);
  if(unit==1){CLEX_XGZP_COPY(suffix," кПа");}
  else if(unit==2){CLEX_XGZP_COPY(suffix," бар");}
  else if(unit==3){CLEX_XGZP_COPY(suffix," мм рт. ст.");}
  else if(unit==4){CLEX_XGZP_COPY(suffix," PSI");}
  else {CLEX_XGZP_COPY(suffix," Па");}
  snprintf(v->text,sizeof(v->text),"%.12s%.19s",number,suffix);
  clex_xgzp_number(number,sizeof(number),v->temperature,2);
  CLEX_XGZP_COPY(suffix," °C");
  snprintf(v->temperatureText,sizeof(v->temperatureText),"%.12s%.19s",number,suffix);
}
#undef CLEX_XGZP_COPY
`;
