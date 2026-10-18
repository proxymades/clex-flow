import test from 'node:test';
import {runHostC} from './host-c.js';
import {TEMPERATURE_RUNTIME} from '../src/firmware/drivers/esp-idf/temperature.js';

test('actual temperature runtime clears stale values on failure, rejects nonfinite readings and recovers',()=>{
  runHostC(String.raw`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <assert.h>
typedef int esp_err_t;
typedef void* temperature_sensor_handle_t;
typedef struct {int min,max;} temperature_sensor_config_t;
#define TEMPERATURE_SENSOR_CONFIG_DEFAULT(a,b) {a,b}
#define ESP_OK 0
#define ESP_FAIL 1
#define ESP_LOGE(...) ((void)0)
static int install_error,enable_error,read_error,installs,reads,uninstalls;
static float input;
static esp_err_t temperature_sensor_install(const temperature_sensor_config_t*c,temperature_sensor_handle_t*h){assert(c->min==-10&&c->max==80);installs++;if(install_error)return install_error;*h=(void*)1;return 0;}
static esp_err_t temperature_sensor_enable(temperature_sensor_handle_t h){assert(h==(void*)1);return enable_error;}
static esp_err_t temperature_sensor_uninstall(temperature_sensor_handle_t h){assert(h==(void*)1);uninstalls++;return 0;}
static esp_err_t temperature_sensor_get_celsius(temperature_sensor_handle_t h,float*out){assert(h==(void*)1);reads++;*out=input;return read_error;}
static const char*esp_err_to_name(esp_err_t e){return e?"ESP_FAIL":"ESP_OK";}
`+TEMPERATURE_RUNTIME+String.raw`
int main(void){
 clex_temperature_value_t a={.value=NAN},b={.value=NAN};
 clex_temperature_initialize();assert(installs==1);
 input=54.25f;assert(clex_temperature_read(&a));assert(a.valid&&a.value==input);assert(strstr(a.text,"°C")&&a.error[0]==0);
 input=105;assert(clex_temperature_read(&b));assert(b.valid&&b.value==105&&installs==1);
 read_error=ESP_FAIL;assert(!clex_temperature_read(&a));assert(!a.valid&&isnan(a.value));assert(!strcmp(a.text,"Нет данных"));assert(strstr(a.error,"ESP_FAIL"));
 read_error=0;input=NAN;assert(!clex_temperature_read(&a));assert(isnan(a.value));input=INFINITY;assert(!clex_temperature_read(&a));
 input=43.5f;assert(clex_temperature_read(&a));assert(a.valid&&a.error[0]==0&&strstr(a.text,"43.5"));
 install_error=ESP_FAIL;clex_temperature_initialize();int before=reads;assert(!clex_temperature_read(&a));assert(reads==before&&isnan(a.value));
 install_error=0;enable_error=ESP_FAIL;clex_temperature_initialize();assert(uninstalls==1&&clex_temperature_handle==NULL);assert(!clex_temperature_read(&a)&&reads==before);
 return 0;
}
`,'clex-temperature-');
});
