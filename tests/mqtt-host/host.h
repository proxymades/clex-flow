// POSIX test adapters for the real ESP-MQTT client. Not included in firmware.
#pragma once
#include <assert.h>
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <net/if.h>
#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_INVALID_SIZE 0x104
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_NOT_SUPPORTED 0x106
#define ESP_ERR_TIMEOUT 0x107
#define ESP_ERR_INVALID_RESPONSE 0x108
#define ESP_ERR_INVALID_VERSION 0x109
#define ESP_ERR_NOT_FINISHED 0x10a
#define ESP_IDF_VERSION_VAL(a,b,c) (((a)<<16)|((b)<<8)|(c))
#define ESP_IDF_VERSION ESP_IDF_VERSION_VAL(5,4,4)
#define IDF_VER "v5.4.4-host-adapter"
#define ESP_LOGE(tag,...) do {fprintf(stderr,"E [%s] ",tag);fprintf(stderr,__VA_ARGS__);fputc('\n',stderr);} while(0)
#define ESP_LOGW(tag,...) do {fprintf(stderr,"W [%s] ",tag);fprintf(stderr,__VA_ARGS__);fputc('\n',stderr);} while(0)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGD(...) ((void)0)
#define ESP_LOGV(...) ((void)0)
#define MALLOC_CAP_DEFAULT 0
#define MALLOC_CAP_INTERNAL 1
#define MALLOC_CAP_8BIT 2
#define heap_caps_malloc(a,b) malloc(a)
#define heap_caps_calloc(a,b,c) calloc(a,b)
#define heap_caps_free free
#define pdTRUE 1
#define pdFALSE 0
#define pdPASS 1
#define portMAX_DELAY UINT32_MAX
#define portTICK_PERIOD_MS 1
#define pdMS_TO_TICKS(a) (a)
typedef unsigned TickType_t;
typedef int BaseType_t;
typedef unsigned UBaseType_t;
typedef void *TaskHandle_t;
typedef struct host_mutex *SemaphoreHandle_t;
typedef struct host_event *EventGroupHandle_t;
typedef struct host_queue *QueueHandle_t;
typedef unsigned EventBits_t;
SemaphoreHandle_t xSemaphoreCreateRecursiveMutex(void);
SemaphoreHandle_t xSemaphoreCreateMutex(void);
int xSemaphoreTakeRecursive(SemaphoreHandle_t,unsigned);
int xSemaphoreGiveRecursive(SemaphoreHandle_t);
#define xSemaphoreTake xSemaphoreTakeRecursive
#define xSemaphoreGive xSemaphoreGiveRecursive
void vSemaphoreDelete(SemaphoreHandle_t);
EventGroupHandle_t xEventGroupCreate(void);
unsigned xEventGroupSetBits(EventGroupHandle_t,unsigned);
unsigned xEventGroupClearBits(EventGroupHandle_t,unsigned);
unsigned xEventGroupGetBits(EventGroupHandle_t);
unsigned xEventGroupWaitBits(EventGroupHandle_t,unsigned,int,int,unsigned);
void vEventGroupDelete(EventGroupHandle_t);
int xTaskCreate(void(*)(void*),const char*,unsigned,void*,unsigned,TaskHandle_t*);
TaskHandle_t xTaskGetCurrentTaskHandle(void);
void vTaskDelete(void*);
void vTaskDelay(unsigned);
QueueHandle_t xQueueCreate(unsigned,unsigned);
int xQueueSend(QueueHandle_t,const void*,unsigned);
int xQueueReceive(QueueHandle_t,void*,unsigned);
void vQueueDelete(QueueHandle_t);
const char *esp_err_to_name(int);
int64_t esp_timer_get_time(void);
uint64_t platform_tick_get_ms(void);
int platform_random(int);
char *platform_create_id_string(void);
typedef const char *esp_event_base_t;
typedef void(*esp_event_handler_t)(void*,esp_event_base_t,int32_t,void*);
typedef struct host_loop *esp_event_loop_handle_t;
typedef struct {int queue_size;const char *task_name;int task_priority,task_stack_size,task_core_id;} esp_event_loop_args_t;
#define ESP_EVENT_DECLARE_BASE(a) extern esp_event_base_t a
#define ESP_EVENT_DEFINE_BASE(a) esp_event_base_t a=#a
#define ESP_EVENT_ANY_ID -1
int esp_event_loop_create(const esp_event_loop_args_t*,esp_event_loop_handle_t*);
int esp_event_loop_delete(esp_event_loop_handle_t);
int esp_event_handler_register_with(esp_event_loop_handle_t,esp_event_base_t,int32_t,esp_event_handler_t,void*);
int esp_event_handler_unregister_with(esp_event_loop_handle_t,esp_event_base_t,int32_t,esp_event_handler_t);
int esp_event_post_to(esp_event_loop_handle_t,esp_event_base_t,int32_t,const void*,size_t,unsigned);
int esp_event_loop_run(esp_event_loop_handle_t,unsigned);
typedef struct psk_key_hint {const char *hint;const uint8_t *key;size_t key_size;} psk_hint_key_t;
typedef int esp_tls_proto_ver_t;
typedef int esp_tls_addr_family_t;
struct esp_tls_last_error {int code,flags,stack;};
int esp_tls_get_and_clear_last_error(struct esp_tls_last_error*,int*,int*);
#define tskNO_AFFINITY -1
#define xTaskCreatePinnedToCore(fn,n,s,a,p,h,c) xTaskCreate(fn,n,s,a,p,h)
