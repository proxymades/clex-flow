import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostC} from './host-c.js';
import {stepperProject} from './stepper-fixture.js';
import {stepperFirmware} from '../src/firmware/drivers/stepper.js';

const support=String.raw`
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <assert.h>
typedef int esp_err_t;
#define ESP_OK 0
#define GPIO_MODE_OUTPUT 1
#define GPTIMER_CLK_SRC_DEFAULT 0
#define GPTIMER_COUNT_UP 0
typedef int portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED 0
static int lock_depth,in_isr;
#define portENTER_CRITICAL(m) do{(void)(m);assert(!lock_depth);lock_depth++;}while(0)
#define portEXIT_CRITICAL(m) do{(void)(m);assert(lock_depth==1);lock_depth--;}while(0)
#define portENTER_CRITICAL_ISR(m) portENTER_CRITICAL(m)
#define portEXIT_CRITICAL_ISR(m) portEXIT_CRITICAL(m)
typedef struct {uint64_t alarm_value,count_value;} gptimer_alarm_event_data_t;
struct mock_timer;
typedef struct mock_timer*gptimer_handle_t;
typedef bool(*alarm_cb_t)(gptimer_handle_t,const gptimer_alarm_event_data_t*,void*);
typedef struct {int clk_src,direction;uint32_t resolution_hz;} gptimer_config_t;
typedef struct {uint64_t alarm_count;} gptimer_alarm_config_t;
typedef struct {alarm_cb_t on_alarm;} gptimer_event_callbacks_t;
struct mock_timer{uint64_t now,alarm;bool enabled,running;alarm_cb_t callback;void*context;};
static struct mock_timer mock_timers[2];static unsigned timer_count;
static unsigned fail_create,fail_alarm;static uint64_t now_us;
static int levels[64],configured[64];static unsigned rising_edges[64],notifications,completed,stopped,failed;
typedef struct {uint64_t pin_bit_mask;int mode;} gpio_config_t;
static int gpio_set_level(int pin,int level){assert(pin>=0&&pin<64);if(level&&!levels[pin]&&configured[pin])rising_edges[pin]++;levels[pin]=level;return 0;}
static int gpio_config(const gpio_config_t*c){assert(c->mode==GPIO_MODE_OUTPUT);for(unsigned p=0;p<64;p++)if(c->pin_bit_mask&(1ULL<<p))configured[p]=1;return 0;}
static int gptimer_new_timer(const gptimer_config_t*c,gptimer_handle_t*out){assert(c->resolution_hz==1000000);if(fail_create)return 1;*out=&mock_timers[timer_count++];return 0;}
static int gptimer_register_event_callbacks(gptimer_handle_t t,const gptimer_event_callbacks_t*c,void*ctx){assert(!t->enabled);t->callback=c->on_alarm;t->context=ctx;return 0;}
static int gptimer_enable(gptimer_handle_t t){t->enabled=true;return 0;}
static int gptimer_start(gptimer_handle_t t){assert(t->enabled);t->running=true;return 0;}
static int gptimer_get_raw_count(gptimer_handle_t t,uint64_t*out){*out=t->now;return 0;}
static int gptimer_set_alarm_action(gptimer_handle_t t,const gptimer_alarm_config_t*c){assert(t);if(fail_alarm)return 1;t->alarm=c?c->alarm_count:0;return 0;}
static int64_t esp_timer_get_time(void){return (int64_t)now_us;}
static void fire(gptimer_handle_t t,unsigned late){assert(t->alarm&&t->running);gptimer_alarm_event_data_t event={.alarm_value=t->alarm,.count_value=t->alarm+late};t->now=event.count_value;now_us=t->now;t->alarm=0;in_isr=1;t->callback(t,&event,t->context);in_isr=0;assert(!lock_depth);}
static void node_0_emit_changed(void){assert(!in_isr&&!lock_depth);notifications++;}
static void node_0_emit_completed(void){assert(!in_isr);completed++;}
static void node_0_emit_stopped(void){assert(!in_isr);stopped++;}
static void node_0_emit_failed(void){assert(!in_isr);failed++;}
`;
test('generated GPTimer driver emits exact pulses, defers graph callbacks and safely handles stop, stale alarms and errors',()=>{
 const {project,motion}=stepperProject();const driver=stepperFirmware(project,[motion],new Map([[motion.id,0]]));
 const source=support+driver.source+driver.notify+[...driver.extraFunctions.values()].join('\n')+String.raw`
int main(void){
 clex_sp_initialize();assert(timer_count==1&&clex_sp_drivers[0].core.ready);const clex_sp_config_t*c=&clex_sp_configs[0];assert(levels[c->step]==0&&levels[c->enable]==!c->enable_high);
 clex_sp_poll();assert(notifications==1);assert(clex_sp_start(0,0,200,false,400,400)==0);assert(levels[c->enable]==c->enable_high);
 while(clex_sp_drivers[0].core.moving){fire(clex_sp_drivers[0].timer,0);clex_sp_poll();}
 assert(rising_edges[c->step]==200&&completed==1&&stepper_value_0.position==200&&!levels[c->step]);
 assert(clex_sp_start(0,0,0,true,1000,0)==0);fire(clex_sp_drivers[0].timer,0);uint64_t old_alarm=clex_sp_drivers[0].alarm;
 node_0_release();assert(clex_sp_drivers[0].core.high&&levels[c->enable]==c->enable_high);fire(clex_sp_drivers[0].timer,0);clex_sp_poll();assert(stopped==1&&levels[c->enable]==!c->enable_high);
 assert(clex_sp_start(0,0,2,false,2000,0)==0);gptimer_alarm_event_data_t old={.alarm_value=old_alarm};unsigned before=rising_edges[c->step];in_isr=1;clex_sp_alarm(clex_sp_drivers[0].timer,&old,0);in_isr=0;assert(rising_edges[c->step]==before);
 // Delayed ISR never produces a burst of catch-up edges, or a too-short STEP pulse.
 fire(clex_sp_drivers[0].timer,10000);assert(clex_sp_drivers[0].alarm>=clex_sp_drivers[0].timer->now+10);fire(clex_sp_drivers[0].timer,0);node_0_stop();clex_sp_poll();assert(stopped==2&&!levels[c->step]);
 assert(clex_sp_start(0,0,1,false,100,0)==0);fail_alarm=1;fire(clex_sp_drivers[0].timer,0);fail_alarm=0;clex_sp_poll();assert(failed==1&&!clex_sp_drivers[0].core.moving&&!levels[c->step]&&levels[c->enable]==!c->enable_high);
 assert(!strcmp(clex_sp_read(0).error,"Ошибка аппаратного таймера движения"));
 return 0;
}
`;
 assert.ok(driver.enabled);runHostC(source,'clex-stepper-gptimer-');
});
