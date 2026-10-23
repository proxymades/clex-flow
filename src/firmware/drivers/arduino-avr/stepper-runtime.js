import { STEPPER_CORE } from '../stepper-core.js';
export const AVR_STEPPER_RUNTIME = String.raw`
#include <avr/interrupt.h>
#include <util/atomic.h>
#if F_CPU != 16000000UL
#error "Nano motion requires a 16 MHz ATmega328P"
#endif
${STEPPER_CORE}
static_assert(@COUNT@ <= @DRIVER_LIMIT@, "Stepper drivers exceed Nano motion capacity");
enum { SP_RATE_LIMIT=6 };
typedef struct { uint8_t step,dir,enable; bool enable_high,invert_direction; uint32_t pulse_us; } clex_sp_config_t;
static const clex_sp_config_t clex_sp_configs[@COUNT@]=@CONFIG@;
typedef struct {
 clex_sp_core_t core;
 uint32_t remaining,published_at,published_position;
 unsigned published_error;
 bool seen,published_moving,published_enabled;
} clex_sp_driver_t;
typedef struct { bool moving,enabled; int32_t position; uint32_t emitted; const char*error; } clex_sp_snapshot_t;
static clex_sp_driver_t clex_sp_drivers[@COUNT@];
static void clex_sp_notify(unsigned driver,unsigned owner,unsigned events,clex_sp_snapshot_t value);
static void clex_sp_poll(void);
static const char*clex_sp_error(unsigned code){switch(code){
 case SP_BUSY:return PSTR("Двигатель уже выполняет движение");
 case SP_NOT_READY:return PSTR("Шаговый драйвер не готов");
 case SP_POSITION_LIMIT:return PSTR("Исчерпан диапазон расчетной позиции");
 case SP_ARGUMENT:return PSTR("Недопустимые параметры движения");
 case SP_RATE_LIMIT:return PSTR("Превышена общая частота движения Nano");
 default:return PSTR("");
}}
static clex_sp_snapshot_t clex_sp_snapshot(const clex_sp_core_t*s){
 clex_sp_snapshot_t v={s->moving,s->enabled,s->position,s->emitted,clex_sp_error(s->error)};return v;
}
// Timer1 runs in normal mode at 2 MHz. Stop and debit actual elapsed time
// before changing deadlines; restarting never compresses a late STEP pulse.
static void clex_sp_suspend(void){
 TCCR1B=0;
 uint16_t elapsed=TCNT1/2;
 for(unsigned id=0;id<@COUNT@;id++){
  clex_sp_driver_t*d=&clex_sp_drivers[id];
  if(d->core.moving)d->remaining=d->remaining>elapsed?d->remaining-elapsed:0;
 }
 TCNT1=0;
}
static void clex_sp_schedule(void){
 uint16_t wait=30000;bool active=false;
 for(unsigned id=0;id<@COUNT@;id++)if(clex_sp_drivers[id].core.moving){
  active=true;uint32_t remaining=clex_sp_drivers[id].remaining;if(remaining<wait)wait=(uint16_t)remaining;
 }
 TIMSK1=0;TIFR1=_BV(OCF1A);TCNT1=0;
 if(active){if(wait<5)wait=5;OCR1A=(uint16_t)(wait*2);TIMSK1=_BV(OCIE1A);TCCR1B=_BV(CS11);}
}
ISR(TIMER1_COMPA_vect){
 clex_sp_suspend();
 for(unsigned id=0;id<@COUNT@;id++){
  clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];
  if(d->core.moving&&!d->remaining){
   d->remaining=clex_sp_tick(&d->core);
   digitalWrite(c->step,d->core.high?HIGH:LOW);
   digitalWrite(c->enable,d->core.enabled?c->enable_high:!c->enable_high);
  }
 }
 clex_sp_schedule();
}
static clex_sp_snapshot_t __attribute__((unused)) clex_sp_read(unsigned id){
 clex_sp_core_t s;ATOMIC_BLOCK(ATOMIC_RESTORESTATE){s=clex_sp_drivers[id].core;}return clex_sp_snapshot(&s);
}
static unsigned __attribute__((unused)) clex_sp_start(unsigned id,unsigned owner,uint32_t count,bool reverse,uint32_t speed,uint32_t acceleration){
 clex_sp_poll();unsigned error=SP_OK;
 ATOMIC_BLOCK(ATOMIC_RESTORESTATE){
  clex_sp_suspend();clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];
  uint32_t total=speed;
  for(unsigned other=0;other<@COUNT@;other++)if(other!=id&&clex_sp_drivers[other].core.moving)total+=clex_sp_drivers[other].core.speed;
  if(d->core.moving)error=SP_BUSY;
  else if(speed>@MAX_SPEED@)error=SP_ARGUMENT;
  else if(total>@MAX_TOTAL_SPEED@)error=SP_RATE_LIMIT;
  else error=clex_sp_begin(&d->core,owner,count,reverse,speed,acceleration);
  if(!error){digitalWrite(c->step,LOW);digitalWrite(c->dir,reverse!=c->invert_direction);digitalWrite(c->enable,c->enable_high);d->remaining=d->core.interval_us;}
  clex_sp_schedule();
 }
 return error;
}
static void __attribute__((unused)) clex_sp_stop(unsigned id,unsigned owner,bool release){
 clex_sp_poll();
 ATOMIC_BLOCK(ATOMIC_RESTORESTATE){
  clex_sp_suspend();clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];
  clex_sp_halt(&d->core,owner,release);
  if(!d->core.high){d->remaining=0;digitalWrite(c->step,LOW);digitalWrite(c->enable,d->core.enabled?c->enable_high:!c->enable_high);}
  clex_sp_schedule();
 }
}
static void clex_sp_poll(void){
 static bool publishing;if(publishing)return;publishing=true;
 for(unsigned id=0;id<@COUNT@;id++){
  clex_sp_driver_t*d=&clex_sp_drivers[id];uint32_t now=millis();clex_sp_core_t s;bool changed;
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE){
   s=d->core;
   changed=!d->seen||s.events||s.moving!=d->published_moving||s.enabled!=d->published_enabled||s.error!=d->published_error||((uint32_t)s.position!=d->published_position&&(uint32_t)(now-d->published_at)>=50);
   if(changed){d->core.events=0;d->published_moving=s.moving;d->published_enabled=s.enabled;d->published_error=s.error;d->published_position=(uint32_t)s.position;d->published_at=now;d->seen=true;}
  }
  if(changed)clex_sp_notify(id,s.owner,s.events,clex_sp_snapshot(&s));
 }
 publishing=false;
}
static void clex_sp_initialize(void){
 ATOMIC_BLOCK(ATOMIC_RESTORESTATE){
  TCCR1A=0;TCCR1B=0;TIMSK1=0;TCNT1=0;TIFR1=_BV(OCF1A);
  for(unsigned id=0;id<@COUNT@;id++){
   clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];
   d->core.pulse_us=c->pulse_us;
   digitalWrite(c->step,LOW);digitalWrite(c->dir,LOW);digitalWrite(c->enable,!c->enable_high);
   pinMode(c->step,OUTPUT);pinMode(c->dir,OUTPUT);pinMode(c->enable,OUTPUT);d->core.ready=true;
  }
 }
}
`;
