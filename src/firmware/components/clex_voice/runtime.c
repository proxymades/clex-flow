#include "clex_voice.h"
#include "audio.h"
#include "endpoint.h"
#include "capture.h"
#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sdkconfig.h"
#if CONFIG_ESP_CONSOLE_UART
#include "driver/uart_vfs.h"
#elif CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG
#include "driver/usb_serial_jtag_vfs.h"
#endif
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
enum { SOUND_ACTION,SOUND_ACTIVATION,SOUND_RECOGNITION };
#define SOUND_QUEUE_CAPACITY 4
typedef struct { uint32_t cycle,epoch; int mode; size_t count; int16_t pcm[]; } input_block_t;
typedef struct { int tag; unsigned frequency,duration,volume; uint32_t cycle; unsigned kind; const int16_t *pcm; size_t samples; } sound_request_t;
typedef struct { sound_request_t request; esp_err_t status; int64_t ended; } sound_result_t;
enum { CAPTURE_OK,CAPTURE_NO_SPEECH,CAPTURE_MICROPHONE };
typedef struct { int16_t *pcm; size_t count; bool speech; int error; } capture_t;
static clex_voice_config_t config;
static const esp_afe_sr_iface_t *afe;
static esp_afe_sr_data_t *afe_data;
static QueueHandle_t controls,sounds,sound_results,input_queue,capture_requests,capture_results;
static portMUX_TYPE gate_lock=portMUX_INITIALIZER_UNLOCKED;
static int state=STOPPED;
static bool enabled,audio_busy,recording,capture_fault;
static uint32_t cycle,epoch,drops;
static unsigned pending_sounds;
static int64_t deadline;
static input_block_t *producer,*consumer;
static size_t feed_frames;
static kws_endpoint_t *endpoint;
static cv_capture_t *recorder;
static int16_t *scratch;
static float *mel,*encoded;
static uint32_t worker_cycle,worker_epoch;
static int worker_mode;
static bool queue_sound(sound_request_t request);

static void reply(const char *format,...){va_list args;va_start(args,format);flockfile(stdout);vfprintf(stdout,format,args);fflush(stdout);funlockfile(stdout);va_end(args);}
static void emit(int type,int command,int tag,const char *error){
    clex_voice_event_t event={.type=type,.command=command,.tag=tag};
    if(error)snprintf(event.error,sizeof(event.error),"%s",error);
    if(config.on_event)config.on_event(&event);
}
static bool active(int mode,uint32_t expected_cycle,uint32_t expected_epoch){
    portENTER_CRITICAL(&gate_lock);
    bool value=enabled&&state==mode&&cycle==expected_cycle&&epoch==expected_epoch&&!audio_busy&&!recording&&
        ((mode==WAITING&&config.custom_wake&&config.wake_reference_count)||(mode==OPEN&&esp_timer_get_time()<deadline));
    portEXIT_CRITICAL(&gate_lock);return value;
}
static void activate(uint32_t expected_cycle,uint32_t expected_epoch){
    portENTER_CRITICAL(&gate_lock);
    bool accept=enabled&&state==WAITING&&cycle==expected_cycle&&epoch==expected_epoch&&!audio_busy&&!recording;
    bool chime=config.activation_sound&&config.speaker_enabled&&config.activation_volume>0;
    if(accept){state=chime?CHIME:OPEN;cycle++;epoch++;audio_busy=chime;pending_sounds=chime?1:0;deadline=chime?0:esp_timer_get_time()+(int64_t)config.window_ms*1000;}
    uint32_t current_cycle=cycle;
    portEXIT_CRITICAL(&gate_lock);
    if(!accept)return;
    if(!config.custom_wake)afe->disable_wakenet(afe_data);
    reply("CLEX_VOICE_ACTIVATED\n");emit(CV_ACTIVATED,-1,-1,NULL);
    if(chime){sound_request_t request={.tag=-1,.volume=config.activation_volume,.cycle=current_cycle,.kind=SOUND_ACTIVATION};xQueueSend(sounds,&request,portMAX_DELAY);}
    else reply("CLEX_VOICE_WINDOW remaining_ms=%u\n",config.window_ms);
}
static void utterance(const int16_t *pcm,size_t count,unsigned voiced,bool too_long,void *context){
    (void)context;
    if(!active(worker_mode,worker_cycle,worker_epoch))return;
    cv_result_t found={.label=-1,.candidate=-1,.distance=1e9f,.ratio=1};
    if(!too_long&&voiced>=10){
        int frames=cv_encode(pcm,count,0,encoded,scratch,mel);
        if(frames>0)found=worker_mode==WAITING?cv_classify(encoded,frames,config.wake_references,config.wake_reference_count,1,config.wake_threshold,config.wake_ratio):cv_classify(encoded,frames,config.references,config.reference_count,config.commands,config.threshold,config.ratio);
    }
    if(!active(worker_mode,worker_cycle,worker_epoch))return;
    if(worker_mode==WAITING){if(found.label==0)activate(worker_cycle,worker_epoch);return;}
    if(found.label>=0){
        // Consume one command per activation. Invalidate queued audio before
        // publishing the command so it cannot launch a second action.
        portENTER_CRITICAL(&gate_lock);
        bool accept=enabled&&state==OPEN&&cycle==worker_cycle&&epoch==worker_epoch&&!audio_busy&&!recording&&esp_timer_get_time()<deadline;
        if(accept){state=WAITING;deadline=0;epoch++;}
        portEXIT_CRITICAL(&gate_lock);
        if(!accept)return;
        if(config.recognition_pcm&&config.recognition_samples&&config.recognition_volume){
            sound_request_t response={.kind=SOUND_RECOGNITION,.tag=-1,.pcm=config.recognition_pcm,.samples=config.recognition_samples,.volume=config.recognition_volume};
            if(!queue_sound(response))emit(CV_FAILED,-1,-1,"Не удалось запустить звук после распознавания");
        }
        reply("CLEX_VOICE_COMMAND id=%s distance=%.5f ratio=%.5f\n",config.command_ids[found.label],found.distance,found.ratio);
        emit(CV_RECOGNIZED,found.label,-1,NULL);
        emit(CV_CLOSED,found.label,-1,NULL);
        portENTER_CRITICAL(&gate_lock);bool wake=enabled&&state==WAITING&&!audio_busy;portEXIT_CRITICAL(&gate_lock);
        if(wake&&!config.custom_wake)afe->enable_wakenet(afe_data);
        reply("CLEX_VOICE_WAITING\n");
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
        if(current_drops!=seen_drops){seen_drops=current_drops;worker_cycle=consumer->cycle;worker_epoch=consumer->epoch;worker_mode=consumer->mode;kws_endpoint_discard(endpoint);xQueueReset(input_queue);continue;}
        if(!active(consumer->mode,consumer->cycle,consumer->epoch)){worker_cycle=0;kws_endpoint_reset(endpoint);continue;}
        if(worker_cycle!=consumer->cycle||worker_epoch!=consumer->epoch||worker_mode!=consumer->mode){worker_cycle=consumer->cycle;worker_epoch=consumer->epoch;worker_mode=consumer->mode;kws_endpoint_reset(endpoint);}
        kws_endpoint_push(endpoint,consumer->pcm,consumer->count,utterance,NULL);
    }
}
static void feed_task(void *argument){
    (void)argument;
    int16_t *pcm=heap_caps_malloc(feed_frames*sizeof(int16_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    if(!pcm){emit(CV_FAILED,-1,-1,"Недостаточно памяти аудиопотока");vTaskDelete(NULL);return;}
    capture_t capture={0};int64_t capture_deadline=0;bool input_fault=false,processing_fault=false;
    for(;;){
        if(!capture.pcm&&xQueueReceive(capture_requests,&capture,0)==pdTRUE){
            cv_capture_begin(recorder,capture.pcm,capture.count,capture.speech);capture_deadline=esp_timer_get_time()+10000000;
            reply(capture.speech?"CLEX_VOICE_LISTENING\n":"CLEX_VOICE_RECORDING 3\n");
        }
        if(capture.pcm&&capture.speech&&!recorder->started&&esp_timer_get_time()>=capture_deadline){
            capture.error=input_fault?CAPTURE_MICROPHONE:CAPTURE_NO_SPEECH;xQueueSend(capture_results,&capture,portMAX_DELAY);capture.pcm=NULL;
        }
        portENTER_CRITICAL(&gate_lock);
        int input_mode=state;uint32_t input_cycle=cycle,input_epoch=epoch;bool input_idle=!audio_busy&&!recording;
        portEXIT_CRITICAL(&gate_lock);
        if(cv_audio_read(pcm,feed_frames)!=ESP_OK){
            if(!input_fault){
                portENTER_CRITICAL(&gate_lock);epoch++;drops++;bool capturing=recording;portEXIT_CRITICAL(&gate_lock);
                emit(CV_FAILED,-1,-1,"Ошибка чтения микрофона");reply(capturing?"CLEX_VOICE_RETRY microphone_read\n":"CLEX_VOICE_ERROR microphone_read\n");input_fault=true;
            }
            // Retry transient I2S timeouts without terminating autonomous listening.
            // Keep a capture whole: restart it after a gap rather than join fragments.
            if(capture.pcm){
                bool restart=recorder->used>0;cv_capture_begin(recorder,capture.pcm,capture.count,capture.speech);
                if(restart)reply(capture.speech?"CLEX_VOICE_LISTENING\n":"CLEX_VOICE_RECORDING 3\n");
            }
            vTaskDelay(pdMS_TO_TICKS(100));continue;
        }
        if(input_fault){input_fault=false;reply("CLEX_VOICE_RECOVERED microphone\n");}
        if(capture.pcm){
            bool started=recorder->started;cv_capture_push(recorder,pcm,feed_frames);
            if(!started&&recorder->started)reply("CLEX_VOICE_RECORDING 3\n");
            if(recorder->used==capture.count){xQueueSend(capture_results,&capture,portMAX_DELAY);capture.pcm=NULL;}
        }
        portENTER_CRITICAL(&gate_lock);
        bool process=input_idle&&!audio_busy&&!recording&&input_epoch==epoch;
        bool listen=process&&input_mode==state&&input_cycle==cycle&&((state==OPEN&&config.commands>0)||(state==WAITING&&config.custom_wake&&config.wake_reference_count));
        portEXIT_CRITICAL(&gate_lock);
        if(listen){producer->cycle=input_cycle;producer->epoch=input_epoch;producer->mode=input_mode;producer->count=feed_frames;memcpy(producer->pcm,pcm,feed_frames*sizeof(int16_t));if(xQueueSend(input_queue,producer,0)!=pdTRUE){portENTER_CRITICAL(&gate_lock);drops++;portEXIT_CRITICAL(&gate_lock);}}
        if(process){
            if(afe->feed(afe_data,pcm)<0){
                if(!processing_fault){
                    portENTER_CRITICAL(&gate_lock);epoch++;drops++;portEXIT_CRITICAL(&gate_lock);
                    emit(CV_FAILED,-1,-1,"Ошибка обработки аудио");reply("CLEX_VOICE_ERROR audio_processing\n");processing_fault=true;
                }
                vTaskDelay(pdMS_TO_TICKS(100));
            }else if(processing_fault){processing_fault=false;reply("CLEX_VOICE_RECOVERED processing\n");}
        }
    }
}
static sound_result_t play_sound(sound_request_t request){
    portENTER_CRITICAL(&gate_lock);bool valid=request.kind!=SOUND_ACTIVATION||(state==CHIME&&cycle==request.cycle);portEXIT_CRITICAL(&gate_lock);
    sound_result_t result={.request=request,.status=ESP_ERR_INVALID_STATE};
    if(valid)result.status=request.kind==SOUND_ACTIVATION?cv_audio_chime(request.volume,config.activation_pcm,config.activation_samples):request.pcm?cv_audio_chime(request.volume,request.pcm,request.samples):cv_audio_tone(request.frequency,request.duration,request.volume);
    result.ended=esp_timer_get_time();return result;
}
static void sound_task(void *argument){
    (void)argument;sound_request_t request;
    for(;;){
        if(xQueueReceive(sounds,&request,portMAX_DELAY)!=pdTRUE)continue;
        sound_result_t result=play_sound(request);xQueueSend(sound_results,&result,portMAX_DELAY);
    }
}
static void complete_sound(const sound_result_t *sound){
    portENTER_CRITICAL(&gate_lock);if(pending_sounds)pending_sounds--;audio_busy=pending_sounds>0;epoch++;
    bool open=sound->request.kind==SOUND_ACTIVATION&&state==CHIME&&cycle==sound->request.cycle&&sound->status==ESP_OK;
    if(open){state=OPEN;deadline=sound->ended+(int64_t)config.window_ms*1000;}
    bool wake=enabled&&state==WAITING&&!audio_busy;
    portEXIT_CRITICAL(&gate_lock);
    if(open)reply("CLEX_VOICE_WINDOW remaining_ms=%u\n",config.window_ms);
    if(wake&&!config.custom_wake)afe->enable_wakenet(afe_data);
    if(sound->request.kind==SOUND_ACTION)emit(CV_TONE_DONE,-1,sound->request.tag,sound->status==ESP_OK?NULL:esp_err_to_name(sound->status));
    else if(sound->status!=ESP_OK&&sound->status!=ESP_ERR_INVALID_STATE){
        emit(CV_FAILED,-1,-1,"Ошибка звукового ответа");
        if(sound->request.kind==SOUND_ACTIVATION){portENTER_CRITICAL(&gate_lock);state=enabled?WAITING:STOPPED;deadline=0;epoch++;portEXIT_CRITICAL(&gate_lock);if(!config.custom_wake&&!audio_busy)afe->enable_wakenet(afe_data);}
    }
}
static void close_window(void){
    portENTER_CRITICAL(&gate_lock);
    bool closed=state==OPEN&&esp_timer_get_time()>=deadline;
    if(closed){state=enabled?WAITING:STOPPED;deadline=0;epoch++;}
    bool wait=enabled&&state==WAITING&&!audio_busy;
    portEXIT_CRITICAL(&gate_lock);
    if(closed){if(wait&&!config.custom_wake)afe->enable_wakenet(afe_data);emit(CV_CLOSED,-1,-1,NULL);reply("CLEX_VOICE_WAITING\n");}
}
static void detect_task(void *argument){
    (void)argument;
    for(;;){
        int control;
        while(xQueueReceive(controls,&control,0)==pdTRUE){
            portENTER_CRITICAL(&gate_lock);
            if(control==CONTROL_STOP){enabled=false;state=STOPPED;deadline=0;epoch++;}
            else if((config.custom_wake?config.wake_reference_count>0:config.reference_count&&config.commands)&&!recording){enabled=true;if(state==STOPPED)state=WAITING;}
            bool wake=enabled&&state==WAITING&&!audio_busy;
            portEXIT_CRITICAL(&gate_lock);
            if(wake&&!config.custom_wake)afe->enable_wakenet(afe_data);else afe->disable_wakenet(afe_data);
            if(control==CONTROL_STOP)reply("CLEX_VOICE_STOPPED\n");
            else if(wake)reply("CLEX_VOICE_WAITING\n");
            else if(config.custom_wake?!config.wake_reference_count:!config.reference_count)reply("CLEX_VOICE_ERROR model_not_ready\n");
        }
        sound_result_t sound;
        if(xQueueReceive(sound_results,&sound,0)==pdTRUE)complete_sound(&sound);
        close_window();
        afe_fetch_result_t *result=afe->fetch_with_delay(afe_data,pdMS_TO_TICKS(50));
        if(!result)continue;
        if(result->ret_value==ESP_FAIL){emit(CV_FAILED,-1,-1,"Ошибка распознавателя активации");vTaskDelay(pdMS_TO_TICKS(100));continue;}
        if(!config.custom_wake&&result->wakeup_state==WAKENET_DETECTED){
            portENTER_CRITICAL(&gate_lock);uint32_t current_cycle=cycle,current_epoch=epoch;portEXIT_CRITICAL(&gate_lock);
            activate(current_cycle,current_epoch);
        }
    }
}
static void send_recording(const int16_t *pcm){
    uint32_t hash=2166136261u;const uint8_t *data=(const uint8_t*)pcm;
    for(size_t i=0;i<96000;++i)hash=(hash^data[i])*16777619u;
    flockfile(stdout);
    // PCM may contain any byte, including LF. Console text conversion must not
    // insert CR bytes into the frame. Plain LF also keeps text replies readable.
#if CONFIG_ESP_CONSOLE_UART
    uart_vfs_dev_port_set_tx_line_endings(CONFIG_ESP_CONSOLE_UART_NUM,ESP_LINE_ENDINGS_LF);
#elif CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG
    usb_serial_jtag_vfs_set_tx_line_endings(ESP_LINE_ENDINGS_LF);
#endif
    printf("CLEX_VOICE_BEGIN 96000 16000 1 16 %08" PRIx32 "\n",hash);
    fwrite(pcm,1,96000,stdout);printf("\nCLEX_VOICE_END\n");fflush(stdout);funlockfile(stdout);
}
static void record_audio(unsigned seconds,bool speech){
    if(seconds!=3){reply("CLEX_VOICE_ERROR invalid_duration\n");return;}
    portENTER_CRITICAL(&gate_lock);bool allowed=state==STOPPED&&!audio_busy&&!recording&&!capture_fault;if(allowed)recording=true;portEXIT_CRITICAL(&gate_lock);
    if(!allowed){reply(capture_fault?"CLEX_VOICE_ERROR microphone_restart\n":"CLEX_VOICE_ERROR audio_busy\n");return;}
    capture_t capture={.pcm=heap_caps_malloc(96000,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT),.count=48000,.speech=speech};
    if(!capture.pcm){reply("CLEX_VOICE_ERROR no_memory\n");goto done;}
    xQueueSend(capture_requests,&capture,portMAX_DELAY);
    capture_t completed;
    if(xQueueReceive(capture_results,&completed,pdMS_TO_TICKS(speech?15000:12000))!=pdTRUE){
        // Retain the buffer if a failed I2S task could still own it; a reset will
        // release it. Do not publish an incomplete audio frame.
        capture_fault=true;reply("CLEX_VOICE_ERROR microphone_timeout\n");goto done;
    }
    if(completed.pcm!=capture.pcm){reply("CLEX_VOICE_ERROR capture_mismatch\n");goto done;}
    if(completed.error!=CAPTURE_OK){
        reply(completed.error==CAPTURE_NO_SPEECH?"CLEX_VOICE_ERROR speech_timeout\n":"CLEX_VOICE_ERROR microphone_read\n");
        heap_caps_free(capture.pcm);goto done;
    }
    send_recording(capture.pcm);
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
                if(strcmp(command,"CLEXVOICE INFO")==0){portENTER_CRITICAL(&gate_lock);int current=state;portEXIT_CRITICAL(&gate_lock);reply("CLEX_VOICE_INFO protocol=1 target=%s state=%d model=%s capture=speech\n",CONFIG_IDF_TARGET,current,config.signature);}
                else if(strcmp(command,"CLEXVOICE STOP")==0){int c=CONTROL_STOP;xQueueSend(controls,&c,portMAX_DELAY);}
                else if(strcmp(command,"CLEXVOICE START")==0){int c=CONTROL_START;xQueueSend(controls,&c,portMAX_DELAY);}
                else{
                    unsigned value;char extra;
                    if(strcmp(command,"CLEXVOICE RECORD 3 SPEECH")==0)record_audio(3,true);
                    else if(sscanf(command,"CLEXVOICE RECORD %u %c",&value,&extra)==1)record_audio(value,false);
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
static bool queue_sound(sound_request_t request){
    if(!config.speaker_enabled||!sounds||request.volume>100)return false;
    portENTER_CRITICAL(&gate_lock);bool allowed=!recording&&pending_sounds<SOUND_QUEUE_CAPACITY;if(allowed){pending_sounds++;if(!audio_busy){audio_busy=true;epoch++;}}portEXIT_CRITICAL(&gate_lock);
    if(!allowed)return false;
    if(xQueueSend(sounds,&request,0)==pdTRUE)return true;
    portENTER_CRITICAL(&gate_lock);pending_sounds--;audio_busy=pending_sounds>0;epoch++;portEXIT_CRITICAL(&gate_lock);return false;
}
bool clex_voice_tone(int tag,unsigned frequency,unsigned duration,unsigned volume){
    if(frequency<100||frequency>4000||duration<20||duration>10000)return false;
    return queue_sound((sound_request_t){.tag=tag,.frequency=frequency,.duration=duration,.volume=volume});
}
bool clex_voice_play(int tag,const int16_t *pcm,size_t samples,unsigned volume){
    if(!pcm||samples<800||samples>80000)return false;
    return queue_sound((sound_request_t){.tag=tag,.pcm=pcm,.samples=samples,.volume=volume});
}
esp_err_t clex_voice_start(const clex_voice_config_t *settings){
    if(!settings||controls||(settings->mic_kind==CV_MIC_CODEC&&!settings->bus)||settings->commands<0||settings->commands>CV_MAX_COMMANDS||settings->reference_count>CV_MAX_TEMPLATES||settings->wake_reference_count>CV_MAX_TEMPLATES||(settings->wake_reference_count&&!settings->wake_references)||settings->activation_samples>80000||((settings->activation_pcm==NULL)!=(settings->activation_samples==0))||settings->recognition_samples>80000||((settings->recognition_pcm==NULL)!=(settings->recognition_samples==0))||settings->recognition_volume>100)return ESP_ERR_INVALID_ARG;
    config=*settings;
    esp_err_t status=cv_audio_initialize(&config);if(status!=ESP_OK)return status;
    srmodel_list_t *models=esp_srmodel_init("model");if(!models)return ESP_ERR_NOT_FOUND;
    char *wake=config.custom_wake?NULL:esp_srmodel_filter(models,"wn10","ru_privetesp");if(!config.custom_wake&&(!wake||strcmp(wake,"wn10_ru_privetesp")!=0))return ESP_ERR_NOT_FOUND;
    afe_config_t *setup=afe_config_init("M",models,AFE_TYPE_SR,AFE_MODE_HIGH_PERF);if(!setup)return ESP_ERR_NO_MEM;
    setup->aec_init=false;setup->se_init=false;setup->wakenet_init=!config.custom_wake;setup->wakenet_model_name=wake;setup->wakenet_mode=DET_MODE_90;setup->memory_alloc_mode=AFE_MEMORY_ALLOC_MORE_PSRAM;
    afe=esp_afe_handle_from_config(setup);afe_data=afe?afe->create_from_config(setup):NULL;afe_config_free(setup);if(!afe_data)return ESP_ERR_NO_MEM;
    afe->disable_wakenet(afe_data);feed_frames=afe->get_feed_chunksize(afe_data);
    if(!feed_frames||feed_frames>4096||afe->get_feed_channel_num(afe_data)!=1)return ESP_ERR_NOT_SUPPORTED;
    size_t block_bytes=sizeof(input_block_t)+feed_frames*sizeof(int16_t);
    producer=heap_caps_malloc(block_bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);consumer=heap_caps_malloc(block_bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    endpoint=heap_caps_calloc(1,sizeof(kws_endpoint_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    recorder=heap_caps_calloc(1,sizeof(cv_capture_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    scratch=heap_caps_malloc(KWS_SAMPLES*sizeof(int16_t),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);mel=heap_caps_malloc(KWS_FRAMES*KWS_MELS*sizeof(float),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);encoded=heap_caps_malloc(KWS_FRAMES*CV_COEFFS*sizeof(float),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    controls=xQueueCreate(4,sizeof(int));sounds=xQueueCreate(SOUND_QUEUE_CAPACITY,sizeof(sound_request_t));sound_results=xQueueCreate(1,sizeof(sound_result_t));input_queue=xQueueCreate(64,block_bytes);capture_requests=xQueueCreate(1,sizeof(capture_t));capture_results=xQueueCreate(1,sizeof(capture_t));
    if(!producer||!consumer||!endpoint||!recorder||!scratch||!mel||!encoded||!controls||!sounds||!sound_results||!input_queue||!capture_requests||!capture_results)return ESP_ERR_NO_MEM;
    cv_features_init();
    if(xTaskCreatePinnedToCore(infer_task,"voice_commands",16384,NULL,3,NULL,1)!=pdPASS||xTaskCreate(sound_task,"voice_sound",4096,NULL,4,NULL)!=pdPASS||xTaskCreatePinnedToCore(feed_task,"voice_feed",8192,NULL,5,NULL,0)!=pdPASS||xTaskCreatePinnedToCore(detect_task,"voice_wake",16384,NULL,5,NULL,1)!=pdPASS||xTaskCreate(transport_task,"voice_usb",8192,NULL,2,NULL)!=pdPASS)return ESP_ERR_NO_MEM;
    reply("CLEX_VOICE_READY protocol=1 model=%s\n",config.signature);
    if(config.custom_wake?config.wake_reference_count>0:config.reference_count&&config.commands){int start=CONTROL_START;xQueueSend(controls,&start,portMAX_DELAY);}
    return ESP_OK;
}
