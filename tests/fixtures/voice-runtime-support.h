#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <assert.h>
#ifdef _WIN32
#define flockfile _lock_file
#define funlockfile _unlock_file
#endif
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_STATE 1
#define ESP_ERR_INVALID_ARG 2
#define ESP_ERR_NOT_FOUND 3
#define ESP_ERR_NO_MEM 4
#define ESP_ERR_NOT_SUPPORTED 5
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define CONFIG_IDF_TARGET "host"
#define ESP_LOGE(...) ((void)0)
#define pdTRUE 1
#define pdPASS 1
#define portMAX_DELAY 0xffffffffu
#define pdMS_TO_TICKS(v) (v)
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(p) ((void)(p))
#define portEXIT_CRITICAL(p) ((void)(p))
typedef int portMUX_TYPE;
typedef void *i2c_master_bus_handle_t;
static int64_t mock_time=1000000;
static int64_t esp_timer_get_time(void){return mock_time;}
static void vTaskDelay(unsigned ticks){mock_time+=(int64_t)ticks*1000;}
static void vTaskDelete(void *task){(void)task;}
static int xTaskCreate(void (*fn)(void*),const char *name,unsigned stack,void *arg,unsigned priority,void *handle){(void)fn;(void)name;(void)stack;(void)arg;(void)priority;(void)handle;return pdPASS;}
static int xTaskCreatePinnedToCore(void (*fn)(void*),const char *name,unsigned stack,void *arg,unsigned priority,void *handle,int core){(void)core;return xTaskCreate(fn,name,stack,arg,priority,handle);}
typedef struct {size_t size,capacity,count;unsigned char *data;} mock_queue;
typedef mock_queue *QueueHandle_t;
static QueueHandle_t xQueueCreate(unsigned capacity,size_t size){mock_queue *q=calloc(1,sizeof(*q));q->size=size;q->capacity=capacity;q->data=calloc(capacity,size);return q;}
static int xQueueSend(QueueHandle_t q,const void *value,unsigned ticks){(void)ticks;if(q->count==q->capacity)return 0;memcpy(q->data+q->count++*q->size,value,q->size);return pdTRUE;}
static int xQueueReceive(QueueHandle_t q,void *value,unsigned ticks){(void)ticks;if(!q->count)return 0;memcpy(value,q->data,q->size);q->count--;memmove(q->data,q->data+q->size,q->count*q->size);return pdTRUE;}
static void xQueueReset(QueueHandle_t q){q->count=0;}
static void *heap_caps_malloc(size_t size,unsigned flags){(void)flags;return malloc(size);}
static void *heap_caps_calloc(size_t count,size_t size,unsigned flags){(void)flags;return calloc(count,size);}
static void heap_caps_free(void *value){free(value);}
static const char *esp_err_to_name(esp_err_t error){return error==ESP_OK?"ESP_OK":"ESP_FAIL";}
typedef struct {int unused;} srmodel_list_t;
typedef struct {bool aec_init,se_init,wakenet_init;char *wakenet_model_name;int wakenet_mode,memory_alloc_mode;} afe_config_t;
typedef struct {int unused;} esp_afe_sr_data_t;
typedef struct {int ret_value,wakeup_state;} afe_fetch_result_t;
typedef struct {esp_afe_sr_data_t *(*create_from_config)(afe_config_t*);int (*feed)(esp_afe_sr_data_t*,const int16_t*);afe_fetch_result_t *(*fetch_with_delay)(esp_afe_sr_data_t*,unsigned);void (*enable_wakenet)(esp_afe_sr_data_t*);void (*disable_wakenet)(esp_afe_sr_data_t*);int (*get_feed_chunksize)(esp_afe_sr_data_t*);int (*get_feed_channel_num)(esp_afe_sr_data_t*);} esp_afe_sr_iface_t;
#define AFE_TYPE_SR 0
#define AFE_MODE_HIGH_PERF 0
#define AFE_MEMORY_ALLOC_MORE_PSRAM 0
#define DET_MODE_90 0
#define WAKENET_DETECTED 1
static unsigned mock_enable,mock_disable;
static void mock_wake_enable(esp_afe_sr_data_t *data){(void)data;mock_enable++;}
static void mock_wake_disable(esp_afe_sr_data_t *data){(void)data;mock_disable++;}
static esp_afe_sr_data_t *mock_create(afe_config_t *config){(void)config;static esp_afe_sr_data_t data;return &data;}
static int mock_feed(esp_afe_sr_data_t *data,const int16_t *pcm){(void)data;(void)pcm;return 0;}
static afe_fetch_result_t *mock_fetch(esp_afe_sr_data_t *data,unsigned ticks){(void)data;(void)ticks;return NULL;}
static int mock_frames(esp_afe_sr_data_t *data){(void)data;return 512;}
static int mock_channels(esp_afe_sr_data_t *data){(void)data;return 1;}
static const esp_afe_sr_iface_t mock_afe={mock_create,mock_feed,mock_fetch,mock_wake_enable,mock_wake_disable,mock_frames,mock_channels};
static srmodel_list_t *esp_srmodel_init(const char *name){(void)name;static srmodel_list_t models;return &models;}
static char *esp_srmodel_filter(srmodel_list_t *models,const char *name,const char *language){(void)models;(void)name;(void)language;return "wn10_ru_privetesp";}
static afe_config_t *afe_config_init(const char *channels,srmodel_list_t *models,int type,int mode){(void)channels;(void)models;(void)type;(void)mode;return calloc(1,sizeof(afe_config_t));}
static void afe_config_free(afe_config_t *config){free(config);}
static const esp_afe_sr_iface_t *esp_afe_handle_from_config(afe_config_t *config){(void)config;return &mock_afe;}
