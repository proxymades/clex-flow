#include "clex_voice.h"
#include "audio.h"
#include "endpoint.h"
#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_afe_config.h"
#include "esp_afe_sr_iface.h"
#include "esp_afe_sr_models.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "model_path.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

enum { STOPPED,WAITING,CHIME,OPEN };
enum { CONTROL_STOP,CONTROL_START };
typedef struct { uint32_t cycle,epoch; size_t count; int16_t pcm[]; } input_block_t;
typedef struct { int tag; unsigned frequency,duration,volume; uint32_t cycle; bool chime; } sound_request_t;
typedef struct { sound_request_t request; esp_err_t status; int64_t ended; } sound_result_t;
typedef struct { int16_t *pcm; size_t count; } capture_t;
static clex_voice_config_t config;
static const esp_afe_sr_iface_t *afe;
static esp_afe_sr_data_t *afe_data;
static QueueHandle_t controls,sounds,sound_results,input_queue,capture_requests,capture_results;
static portMUX_TYPE gate_lock=portMUX_INITIALIZER_UNLOCKED;
static int state=STOPPED;
static bool enabled,audio_busy,recording,capture_fault;
static uint32_t cycle,epoch,drops;
static int64_t deadline;
static input_block_t *producer,*consumer;
static size_t feed_frames;
static kws_endpoint_t *endpoint;
static int16_t *scratch;
static float *mel,*encoded;
static uint32_t worker_cycle,worker_epoch;

static void reply(const char *format,...){va_list args;va_start(args,format);flockfile(stdout);vfprintf(stdout,format,args);fflush(stdout);funlockfile(stdout);va_end(args);}
static void emit(int type,int command,int tag,const char *error){
    clex_voice_event_t event={.type=type,.command=command,.tag=tag};
    if(error)snprintf(event.error,sizeof(event.error),"%s",error);
    if(config.on_event)config.on_event(&event);
}
static bool active(uint32_t expected_cycle,uint32_t expected_epoch){
    portENTER_CRITICAL(&gate_lock);
    bool value=state==OPEN&&cycle==expected_cycle&&epoch==expected_epoch&&!audio_busy&&esp_timer_get_time()<deadline;
    portEXIT_CRITICAL(&gate_lock);return value;
}
static void utterance(const int16_t *pcm,size_t count,unsigned voiced,bool too_long,void *context){
    (void)context;
    if(!active(worker_cycle,worker_epoch))return;
    cv_result_t found={.label=-1,.candidate=-1,.distance=1e9f,.ratio=1};
    if(!too_long&&voiced>=10){
        int frames=cv_encode(pcm,count,0,encoded,scratch,mel);
        if(frames>0)found=cv_classify(encoded,frames,config.references,config.reference_count,config.commands,config.threshold,config.ratio);
    }
    if(!active(worker_cycle,worker_epoch))return;
    if(found.label>=0){
        reply("CLEX_VOICE_COMMAND id=%s distance=%.5f ratio=%.5f\n",config.command_ids[found.label],found.distance,found.ratio);
        emit(CV_RECOGNIZED,found.label,-1,NULL);
    }else{
        reply("CLEX_VOICE_UNCERTAIN distance=%.5f ratio=%.5f\n",found.distance,found.ratio);
        emit(CV_UNCERTAIN,-1,-1,NULL);
    }
}
static void infer_task(void *argument){
    (void)argument;unsigned seen_drops=0;
    for(;;){
        if(xQueueReceive(input_queue,consumer,portMAX_DELAY)!=pdTRUE)continue;
        portENTER_CRITICAL(&gate_lock);unsigned current_drops=drops;portEXIT_CRITICAL(&gate_lock);
        if(current_drops!=seen_drops){seen_drops=current_drops;worker_cycle=consumer->cycle;worker_epoch=consumer->epoch;kws_endpoint_discard(endpoint);xQueueReset(input_queue);continue;}
        if(!active(consumer->cycle,consumer->epoch)){worker_cycle=0;kws_endpoint_reset(endpoint);continue;}
        if(worker_cycle!=consumer->cycle||worker_epoch!=consumer->epoch){worker_cycle=consumer->cycle;worker_epoch=consumer->epoch;kws_endpoint_reset(endpoint);}
        kws_endpoint_push(endpoint,consumer->pcm,consumer->count,utterance,NULL);
    }
}
static void feed_task(void *argument){
    (void)argument;
    int16_t *pcm=heap_caps_malloc(feed_frames*sizeof(int16_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    if(!pcm){emit(CV_FAILED,-1,-1,"Недостаточно памяти аудиопотока");vTaskDelete(NULL);return;}
    capture_t capture={0};size_t copied=0;
    for(;;){
        if(!capture.pcm&&xQueueReceive(capture_requests,&capture,0)==pdTRUE){copied=0;reply("CLEX_VOICE_RECORDING 3\n");}
        if(cv_audio_read(pcm,feed_frames)!=ESP_OK){emit(CV_FAILED,-1,-1,"Ошибка чтения микрофона");reply("CLEX_VOICE_ERROR microphone_read\n");vTaskDelete(NULL);return;}
        if(capture.pcm){
            size_t n=capture.count-copied;if(n>feed_frames)n=feed_frames;
            memcpy(capture.pcm+copied,pcm,n*sizeof(int16_t));copied+=n;
            if(copied==capture.count){xQueueSend(capture_results,&capture,portMAX_DELAY);capture.pcm=NULL;}
        }
        portENTER_CRITICAL(&gate_lock);
        bool listen=state==OPEN&&!audio_busy;uint32_t current_cycle=cycle,current_epoch=epoch;
        portEXIT_CRITICAL(&gate_lock);
        if(listen){producer->cycle=current_cycle;producer->epoch=current_epoch;producer->count=feed_frames;memcpy(producer->pcm,pcm,feed_frames*sizeof(int16_t));if(xQueueSend(input_queue,producer,0)!=pdTRUE){portENTER_CRITICAL(&gate_lock);drops++;portEXIT_CRITICAL(&gate_lock);}}
        if(afe->feed(afe_data,pcm)<0){emit(CV_FAILED,-1,-1,"Ошибка обработки аудио");vTaskDelete(NULL);return;}
    }
}
static void sound_task(void *argument){
    (void)argument;sound_request_t request;
    for(;;){
        if(xQueueReceive(sounds,&request,portMAX_DELAY)!=pdTRUE)continue;
        portENTER_CRITICAL(&gate_lock);bool valid=!request.chime||(state==CHIME&&cycle==request.cycle);portEXIT_CRITICAL(&gate_lock);
        sound_result_t result={.request=request,.status=ESP_ERR_INVALID_STATE};
        if(valid)result.status=request.chime?cv_audio_chime(request.volume):cv_audio_tone(request.frequency,request.duration,request.volume);
        result.ended=esp_timer_get_time();xQueueSend(sound_results,&result,portMAX_DELAY);
    }
}
static void detect_task(void *argument){
    (void)argument;
    for(;;){
        int control;
        while(xQueueReceive(controls,&control,0)==pdTRUE){
            portENTER_CRITICAL(&gate_lock);
            if(control==CONTROL_STOP){enabled=false;state=STOPPED;deadline=0;epoch++;}
            else if(config.reference_count&&config.commands&&!recording){enabled=true;if(state==STOPPED)state=WAITING;}
            bool wake=enabled&&state==WAITING&&!audio_busy;
            portEXIT_CRITICAL(&gate_lock);
            if(wake)afe->enable_wakenet(afe_data);else afe->disable_wakenet(afe_data);
            if(control==CONTROL_STOP)reply("CLEX_VOICE_STOPPED\n");
            else if(wake)reply("CLEX_VOICE_WAITING\n");
            else if(!config.reference_count)reply("CLEX_VOICE_ERROR model_not_ready\n");
        }
        sound_result_t sound;
        if(xQueueReceive(sound_results,&sound,0)==pdTRUE){
            portENTER_CRITICAL(&gate_lock);audio_busy=false;epoch++;
            bool open=sound.request.chime&&state==CHIME&&cycle==sound.request.cycle&&sound.status==ESP_OK;
            if(open){state=OPEN;deadline=sound.ended+(int64_t)config.window_ms*1000;}
            bool wake=enabled&&state==WAITING;
            portEXIT_CRITICAL(&gate_lock);
            if(open)reply("CLEX_VOICE_WINDOW remaining_ms=%u\n",config.window_ms);
            if(wake)afe->enable_wakenet(afe_data);
            if(!sound.request.chime)emit(CV_TONE_DONE,-1,sound.request.tag,sound.status==ESP_OK?NULL:esp_err_to_name(sound.status));
            else if(sound.status!=ESP_OK&&sound.status!=ESP_ERR_INVALID_STATE){emit(CV_FAILED,-1,-1,"Ошибка звукового сигнала");portENTER_CRITICAL(&gate_lock);state=WAITING;portEXIT_CRITICAL(&gate_lock);afe->enable_wakenet(afe_data);}
        }
        portENTER_CRITICAL(&gate_lock);
        bool closed=state==OPEN&&esp_timer_get_time()>=deadline;
        if(closed){state=enabled?WAITING:STOPPED;deadline=0;epoch++;}
        bool wait=enabled&&state==WAITING;
        portEXIT_CRITICAL(&gate_lock);
        if(closed){if(wait)afe->enable_wakenet(afe_data);emit(CV_CLOSED,-1,-1,NULL);reply("CLEX_VOICE_WAITING\n");}
        afe_fetch_result_t *result=afe->fetch_with_delay(afe_data,pdMS_TO_TICKS(50));
        if(!result)continue;
        if(result->ret_value==ESP_FAIL){emit(CV_FAILED,-1,-1,"Ошибка распознавателя активации");vTaskDelay(pdMS_TO_TICKS(100));continue;}
        if(result->wakeup_state==WAKENET_DETECTED){
            portENTER_CRITICAL(&gate_lock);
            bool accept=enabled&&state==WAITING&&!audio_busy&&!recording;
            if(accept){state=CHIME;cycle++;epoch++;audio_busy=true;}
            uint32_t current_cycle=cycle;
            portEXIT_CRITICAL(&gate_lock);
            if(accept){afe->disable_wakenet(afe_data);reply("CLEX_VOICE_ACTIVATED\n");emit(CV_ACTIVATED,-1,-1,NULL);sound_request_t request={.tag=-1,.volume=config.volume,.cycle=current_cycle,.chime=true};xQueueSend(sounds,&request,portMAX_DELAY);}
        }
    }
}
static void record_audio(unsigned seconds){
    if(seconds!=3){reply("CLEX_VOICE_ERROR invalid_duration\n");return;}
    portENTER_CRITICAL(&gate_lock);bool allowed=state==STOPPED&&!audio_busy&&!recording&&!capture_fault;if(allowed)recording=true;portEXIT_CRITICAL(&gate_lock);
    if(!allowed){reply(capture_fault?"CLEX_VOICE_ERROR microphone_restart\n":"CLEX_VOICE_ERROR audio_busy\n");return;}
    capture_t capture={.pcm=heap_caps_malloc(96000,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT),.count=48000};
    if(!capture.pcm){reply("CLEX_VOICE_ERROR no_memory\n");goto done;}
    xQueueSend(capture_requests,&capture,portMAX_DELAY);
    capture_t completed;
    if(xQueueReceive(capture_results,&completed,pdMS_TO_TICKS(12000))!=pdTRUE){
        // Retain the buffer if a failed I2S task could still own it; a reset will
        // release it. Do not publish an incomplete audio frame.
        capture_fault=true;reply("CLEX_VOICE_ERROR microphone_timeout\n");goto done;
    }
    if(completed.pcm!=capture.pcm){reply("CLEX_VOICE_ERROR capture_mismatch\n");goto done;}
    uint32_t hash=2166136261u;const uint8_t *data=(const uint8_t*)capture.pcm;
    for(size_t i=0;i<96000;++i)hash=(hash^data[i])*16777619u;
    flockfile(stdout);
    printf("CLEX_VOICE_BEGIN 96000 16000 1 16 %08" PRIx32 "\n",hash);
    fwrite(capture.pcm,1,96000,stdout);printf("\nCLEX_VOICE_END\n");fflush(stdout);funlockfile(stdout);
    heap_caps_free(capture.pcm);
done:
    portENTER_CRITICAL(&gate_lock);recording=false;portEXIT_CRITICAL(&gate_lock);
}
static void transport_task(void *argument){
    (void)argument;char command[80];size_t used=0;bool overflow=false;
    for(;;){
        int byte=getchar();if(byte==EOF){clearerr(stdin);vTaskDelay(pdMS_TO_TICKS(5));continue;}
        if(byte=='\r')continue;
        if(byte=='\n'){
            command[used]=0;
            if(!overflow&&used){
                if(strcmp(command,"CLEXVOICE INFO")==0){portENTER_CRITICAL(&gate_lock);int current=state;portEXIT_CRITICAL(&gate_lock);reply("CLEX_VOICE_INFO protocol=1 target=esp32p4 state=%d model=%s\n",current,config.signature);}
                else if(strcmp(command,"CLEXVOICE STOP")==0){int c=CONTROL_STOP;xQueueSend(controls,&c,portMAX_DELAY);}
                else if(strcmp(command,"CLEXVOICE START")==0){int c=CONTROL_START;xQueueSend(controls,&c,portMAX_DELAY);}
                else{
                    unsigned value;char extra;
                    if(sscanf(command,"CLEXVOICE RECORD %u %c",&value,&extra)==1)record_audio(value);
                    else if(sscanf(command,"CLEXVOICE GAIN %u %c",&value,&extra)==1){
                        portENTER_CRITICAL(&gate_lock);bool allowed=state==STOPPED&&!recording;portEXIT_CRITICAL(&gate_lock);
                        if(allowed&&value<=42&&value%6==0&&cv_audio_gain(value)==ESP_OK)reply("CLEX_VOICE_GAIN %u\n",value);else reply("CLEX_VOICE_ERROR invalid_gain\n");
                    }
                }
            }
            used=0;overflow=false;
        }else if(!overflow&&used<sizeof(command)-1)command[used++]=(char)byte;else overflow=true;
    }
}
bool clex_voice_tone(int tag,unsigned frequency,unsigned duration,unsigned volume){
    if(!sounds||frequency<100||frequency>4000||duration<20||duration>10000||volume>100)return false;
    portENTER_CRITICAL(&gate_lock);bool allowed=!audio_busy&&!recording;if(allowed){audio_busy=true;epoch++;}portEXIT_CRITICAL(&gate_lock);
    if(!allowed)return false;
    sound_request_t request={.tag=tag,.frequency=frequency,.duration=duration,.volume=volume};
    if(xQueueSend(sounds,&request,0)==pdTRUE)return true;
    portENTER_CRITICAL(&gate_lock);audio_busy=false;portEXIT_CRITICAL(&gate_lock);return false;
}
esp_err_t clex_voice_start(const clex_voice_config_t *settings){
    if(!settings||controls||!settings->bus||settings->commands<0||settings->commands>CV_MAX_COMMANDS||settings->reference_count>CV_MAX_TEMPLATES)return ESP_ERR_INVALID_ARG;
    config=*settings;
    esp_err_t status=cv_audio_initialize(&config);if(status!=ESP_OK)return status;
    srmodel_list_t *models=esp_srmodel_init("model");if(!models)return ESP_ERR_NOT_FOUND;
    char *wake=esp_srmodel_filter(models,"wn10","ru_privetesp");if(!wake||strcmp(wake,"wn10_ru_privetesp")!=0)return ESP_ERR_NOT_FOUND;
    afe_config_t *setup=afe_config_init("M",models,AFE_TYPE_SR,AFE_MODE_HIGH_PERF);if(!setup)return ESP_ERR_NO_MEM;
    setup->aec_init=false;setup->se_init=false;setup->wakenet_init=true;setup->wakenet_model_name=wake;setup->wakenet_mode=DET_MODE_90;setup->memory_alloc_mode=AFE_MEMORY_ALLOC_MORE_PSRAM;
    afe=esp_afe_handle_from_config(setup);afe_data=afe?afe->create_from_config(setup):NULL;afe_config_free(setup);if(!afe_data)return ESP_ERR_NO_MEM;
    afe->disable_wakenet(afe_data);feed_frames=afe->get_feed_chunksize(afe_data);
    if(!feed_frames||feed_frames>4096||afe->get_feed_channel_num(afe_data)!=1)return ESP_ERR_NOT_SUPPORTED;
    size_t block_bytes=sizeof(input_block_t)+feed_frames*sizeof(int16_t);
    producer=heap_caps_malloc(block_bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);consumer=heap_caps_malloc(block_bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    endpoint=heap_caps_calloc(1,sizeof(kws_endpoint_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    scratch=heap_caps_malloc(KWS_SAMPLES*sizeof(int16_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);mel=heap_caps_malloc(KWS_FRAMES*KWS_MELS*sizeof(float),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);encoded=heap_caps_malloc(KWS_FRAMES*CV_COEFFS*sizeof(float),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    controls=xQueueCreate(4,sizeof(int));sounds=xQueueCreate(1,sizeof(sound_request_t));sound_results=xQueueCreate(1,sizeof(sound_result_t));input_queue=xQueueCreate(64,block_bytes);capture_requests=xQueueCreate(1,sizeof(capture_t));capture_results=xQueueCreate(1,sizeof(capture_t));
    if(!producer||!consumer||!endpoint||!scratch||!mel||!encoded||!controls||!sounds||!sound_results||!input_queue||!capture_requests||!capture_results)return ESP_ERR_NO_MEM;
    cv_features_init();
    if(xTaskCreatePinnedToCore(infer_task,"voice_commands",16384,NULL,3,NULL,1)!=pdPASS||xTaskCreate(sound_task,"voice_sound",4096,NULL,4,NULL)!=pdPASS||xTaskCreatePinnedToCore(feed_task,"voice_feed",8192,NULL,5,NULL,0)!=pdPASS||xTaskCreatePinnedToCore(detect_task,"voice_wake",16384,NULL,5,NULL,1)!=pdPASS||xTaskCreate(transport_task,"voice_usb",8192,NULL,2,NULL)!=pdPASS)return ESP_ERR_NO_MEM;
    reply("CLEX_VOICE_READY protocol=1 model=%s\n",config.signature);
    if(config.reference_count&&config.commands){int start=CONTROL_START;xQueueSend(controls,&start,portMAX_DELAY);}
    return ESP_OK;
}
