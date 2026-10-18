import {STEPPER_CORE} from '../stepper-core.js';
export const STEPPER_RUNTIME=String.raw`
${STEPPER_CORE}
typedef struct { int step,dir,enable; bool enable_high,invert_direction; uint32_t pulse_us; } clex_sp_config_t;
static const clex_sp_config_t clex_sp_configs[@COUNT@]=@CONFIG@;
typedef struct { clex_sp_core_t core; gptimer_handle_t timer; uint64_t alarm; int64_t published_at; clex_sp_core_t published; bool seen; } clex_sp_driver_t;
typedef struct { bool moving,enabled; int32_t position; uint32_t emitted; char error[128]; } clex_sp_snapshot_t;
static clex_sp_driver_t clex_sp_drivers[@COUNT@];
static portMUX_TYPE clex_sp_mutex=portMUX_INITIALIZER_UNLOCKED;
static void clex_sp_notify(unsigned driver,unsigned owner,unsigned events,clex_sp_snapshot_t value);
static void clex_sp_poll(void);
static const char*clex_sp_error(unsigned code){switch(code){case SP_BUSY:return "Двигатель уже выполняет движение";case SP_NOT_READY:return "Шаговый драйвер не готов";case SP_POSITION_LIMIT:return "Исчерпан диапазон расчетной позиции";case SP_TIMER_ERROR:return "Ошибка аппаратного таймера движения";case SP_ARGUMENT:return "Недопустимые параметры движения";default:return "";}}
static clex_sp_snapshot_t clex_sp_snapshot(const clex_sp_core_t*s){clex_sp_snapshot_t v={.moving=s->moving,.enabled=s->enabled,.position=s->position,.emitted=s->emitted};snprintf(v.error,sizeof(v.error),"%s",clex_sp_error(s->error));return v;}
static bool clex_sp_arm(unsigned id,uint32_t delay){
 clex_sp_driver_t*d=&clex_sp_drivers[id];if(!delay){d->alarm=0;return gptimer_set_alarm_action(d->timer,NULL)==ESP_OK;}
 uint64_t now;if(gptimer_get_raw_count(d->timer,&now)!=ESP_OK)return false;
 d->alarm=now+delay;gptimer_alarm_config_t config={.alarm_count=d->alarm};return gptimer_set_alarm_action(d->timer,&config)==ESP_OK;
}
static void clex_sp_timer_fault(unsigned id){clex_sp_driver_t*d=&clex_sp_drivers[id];d->core.moving=false;d->core.high=false;d->core.enabled=false;d->core.error=SP_TIMER_ERROR;d->core.events|=SP_ERROR;d->alarm=0;gpio_set_level(clex_sp_configs[id].step,0);gpio_set_level(clex_sp_configs[id].enable,!clex_sp_configs[id].enable_high);}
static bool clex_sp_alarm(gptimer_handle_t timer,const gptimer_alarm_event_data_t*event,void*context){
 (void)timer;unsigned id=(unsigned)(uintptr_t)context;clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];
 portENTER_CRITICAL_ISR(&clex_sp_mutex);
 if(d->alarm&&event->alarm_value==d->alarm){uint32_t delay=clex_sp_tick(&d->core);gpio_set_level(c->step,d->core.high);gpio_set_level(c->enable,d->core.enabled?c->enable_high:!c->enable_high);if(!clex_sp_arm(id,delay))clex_sp_timer_fault(id);}
 portEXIT_CRITICAL_ISR(&clex_sp_mutex);return false;
}
static clex_sp_snapshot_t __attribute__((unused)) clex_sp_read(unsigned id){portENTER_CRITICAL(&clex_sp_mutex);clex_sp_core_t s=clex_sp_drivers[id].core;portEXIT_CRITICAL(&clex_sp_mutex);return clex_sp_snapshot(&s);}
static unsigned __attribute__((unused)) clex_sp_start(unsigned id,unsigned owner,uint32_t count,bool reverse,uint32_t speed,uint32_t acceleration){
 clex_sp_poll();clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];
 portENTER_CRITICAL(&clex_sp_mutex);unsigned error=clex_sp_begin(&d->core,owner,count,reverse,speed,acceleration);
 if(!error){gpio_set_level(c->step,0);gpio_set_level(c->dir,reverse!=c->invert_direction);gpio_set_level(c->enable,c->enable_high);if(!clex_sp_arm(id,d->core.interval_us)){clex_sp_timer_fault(id);error=SP_TIMER_ERROR;}}
 portEXIT_CRITICAL(&clex_sp_mutex);return error;
}
static void __attribute__((unused)) clex_sp_stop(unsigned id,unsigned owner,bool release){
 clex_sp_poll();clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];
 portENTER_CRITICAL(&clex_sp_mutex);clex_sp_halt(&d->core,owner,release);
 if(!d->core.high){gpio_set_level(c->step,0);gpio_set_level(c->enable,d->core.enabled?c->enable_high:!c->enable_high);if(d->timer&&!clex_sp_arm(id,0))clex_sp_timer_fault(id);}
 portEXIT_CRITICAL(&clex_sp_mutex);
}
static void clex_sp_poll(void){
 static bool publishing;if(publishing)return;publishing=true;
 for(unsigned id=0;id<@COUNT@;id++){
  clex_sp_driver_t*d=&clex_sp_drivers[id];int64_t now=esp_timer_get_time();
  portENTER_CRITICAL(&clex_sp_mutex);clex_sp_core_t s=d->core;
  bool changed=!d->seen||s.events||s.moving!=d->published.moving||s.enabled!=d->published.enabled||s.error!=d->published.error||(s.position!=d->published.position&&now-d->published_at>=50000);
  if(changed){d->core.events=0;d->published=s;d->published_at=now;d->seen=true;}
  portEXIT_CRITICAL(&clex_sp_mutex);
  if(changed)clex_sp_notify(id,s.owner,s.events,clex_sp_snapshot(&s));
 }
 publishing=false;
}
static void clex_sp_initialize(void){
 for(unsigned id=0;id<@COUNT@;id++){
  clex_sp_driver_t*d=&clex_sp_drivers[id];const clex_sp_config_t*c=&clex_sp_configs[id];d->core.pulse_us=c->pulse_us;
  // Load safe output latches before switching the GPIOs to output mode.
  gpio_set_level(c->step,0);gpio_set_level(c->dir,0);gpio_set_level(c->enable,!c->enable_high);
  gpio_config_t pins={.pin_bit_mask=(1ULL<<c->step)|(1ULL<<c->dir)|(1ULL<<c->enable),.mode=GPIO_MODE_OUTPUT};
  gptimer_config_t config={.clk_src=GPTIMER_CLK_SRC_DEFAULT,.direction=GPTIMER_COUNT_UP,.resolution_hz=1000000};gptimer_event_callbacks_t callbacks={.on_alarm=clex_sp_alarm};
  esp_err_t error=gpio_config(&pins);if(error==ESP_OK)error=gptimer_new_timer(&config,&d->timer);
  if(error==ESP_OK)error=gptimer_register_event_callbacks(d->timer,&callbacks,(void*)(uintptr_t)id);
  if(error==ESP_OK)error=gptimer_enable(d->timer);
  if(error==ESP_OK)error=gptimer_start(d->timer);
  d->core.ready=error==ESP_OK;if(error!=ESP_OK){d->core.error=SP_TIMER_ERROR;gpio_set_level(c->enable,!c->enable_high);}
 }
}
`;
