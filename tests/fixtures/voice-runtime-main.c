#include "voice-runtime-support.h"
static bool capture_stdout;
static unsigned char wire[100000];
static size_t wire_size;
static size_t transport_fwrite(const void *data,size_t size,size_t count,FILE *stream){
 if(!capture_stdout)return fwrite(data,size,count,stream);
 assert(stream==stdout);const unsigned char *bytes=data;
 for(size_t i=0;i<size*count;i++){
  if(bytes[i]=='\n'&&mock_tx_mode!=ESP_LINE_ENDINGS_LF){assert(wire_size<sizeof(wire));wire[wire_size++]='\r';if(mock_tx_mode==ESP_LINE_ENDINGS_CR)continue;}
  assert(wire_size<sizeof(wire));wire[wire_size++]=bytes[i];
 }
 return count;
}
static int transport_printf(const char *format,...){
 va_list args;va_start(args,format);
 if(!capture_stdout){int result=vprintf(format,args);va_end(args);return result;}
 char buffer[256];int count=vsnprintf(buffer,sizeof(buffer),format,args);va_end(args);assert(count>=0&&(size_t)count<sizeof(buffer));transport_fwrite(buffer,1,(size_t)count,stdout);return count;
}
static int transport_fflush(FILE *stream){return capture_stdout?0:fflush(stream);}
#define fwrite transport_fwrite
#define printf transport_printf
#define fflush transport_fflush
#include "runtime.c"
#undef fwrite
#undef printf
#undef fflush
#include <math.h>
#include <setjmp.h>
static jmp_buf feed_end;
static unsigned audio_read_calls;
static unsigned audio_read_limit=7,audio_time_step;
static bool audio_faults=true;
static bool testing_feed;
static int16_t *feed_buffer;
static unsigned events[CV_TONE_DONE+1];
static int last_tag;
static bool last_error;
static const int16_t *played_pcm;
static size_t played_samples;
static unsigned played_volume;
static esp_err_t audio_status=ESP_OK;
static void on_event(const clex_voice_event_t *event){events[event->type]++;last_tag=event->tag;last_error=event->error[0]!=0;}
esp_err_t cv_audio_initialize(const clex_voice_config_t *settings){(void)settings;return ESP_OK;}
esp_err_t cv_audio_read(int16_t *pcm,size_t samples){
 if(testing_feed){
  feed_buffer=pcm;if(++audio_read_calls>audio_read_limit)longjmp(feed_end,1);
  mock_time+=audio_time_step;
  if(audio_faults&&(audio_read_calls==2||audio_read_calls==3))return ESP_FAIL;
 }
 for(size_t i=0;i<samples;i++){pcm[i]=(int16_t)(testing_feed?audio_read_calls:0);}
 return ESP_OK;
}
esp_err_t cv_audio_gain(unsigned gain){(void)gain;return ESP_OK;}
esp_err_t cv_audio_chime(unsigned volume,const int16_t *pcm,size_t samples){played_pcm=pcm;played_samples=samples;played_volume=volume;mock_time+=400000;return audio_status;}
esp_err_t cv_audio_tone(unsigned frequency,unsigned duration,unsigned volume){(void)frequency;(void)duration;played_volume=volume;return audio_status;}
static int16_t wake_pcm[48000],command_pcm[48000],background_pcm[48000],playback_pcm[1600];
static int16_t reference_data[3][KWS_FRAMES*CV_COEFFS];
static cv_template_t wake_refs[3],command_refs[3];
static void prepare_reference(int index,const int16_t *pcm,int background){
 int frames=cv_encode(pcm,48000,background,encoded,scratch,mel);assert(frames>0);
 for(int j=0;j<frames*CV_COEFFS;j++)reference_data[index][j]=(int16_t)lroundf(encoded[j]*512);
 wake_refs[index]=(cv_template_t){reference_data[index],frames,index,512};
}
static void consume_utterance(const int16_t *pcm){worker_mode=state;worker_cycle=cycle;worker_epoch=epoch;utterance(pcm,48000,60,false,NULL);}
int main(void){
 cv_features_init();afe=&mock_afe;
 scratch=malloc(KWS_SAMPLES*sizeof(int16_t));mel=malloc(KWS_FRAMES*KWS_MELS*sizeof(float));encoded=malloc(KWS_FRAMES*CV_COEFFS*sizeof(float));
 for(int i=6000;i<28000;i++){wake_pcm[i]=(int16_t)(1800*sin(i*.13)+800*sin(i*.39));command_pcm[i]=(int16_t)(1600*sin(i*.29)+1000*sin(i*.71));}
 prepare_reference(0,wake_pcm,0);prepare_reference(1,command_pcm,0);prepare_reference(2,background_pcm,1);
 command_refs[0]=wake_refs[1];command_refs[0].label=0;command_refs[1]=wake_refs[0];command_refs[1].label=1;command_refs[2]=wake_refs[2];
 static const char *ids[]={"a-command"};
 config=(clex_voice_config_t){.custom_wake=true,.wake_references=wake_refs,.wake_reference_count=3,.wake_threshold=.15,.wake_ratio=.9,.references=command_refs,.reference_count=3,.commands=1,.command_ids=ids,.threshold=.15,.ratio=.9,.speaker_enabled=true,.activation_sound=true,.activation_volume=85,.activation_pcm=playback_pcm,.activation_samples=1600,.window_ms=20000,.on_event=on_event};
 sounds=xQueueCreate(SOUND_QUEUE_CAPACITY,sizeof(sound_request_t));state=WAITING;enabled=true;
 consume_utterance(command_pcm);assert(events[CV_ACTIVATED]==0&&events[CV_RECOGNIZED]==0&&events[CV_UNCERTAIN]==0);
 consume_utterance(wake_pcm);assert(state==CHIME&&audio_busy&&events[CV_ACTIVATED]==1&&deadline==0);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==0);
 sound_request_t request;assert(xQueueReceive(sounds,&request,0)==pdTRUE&&request.kind==SOUND_ACTIVATION);
 sound_result_t sound=play_sound(request);assert(played_pcm==playback_pcm&&played_samples==1600&&played_volume==85);
 complete_sound(&sound);assert(state==OPEN&&!audio_busy);assert(deadline==sound.ended+20000000);
 int64_t original_deadline=deadline;
 consume_utterance(wake_pcm);assert(state==OPEN&&events[CV_UNCERTAIN]==1&&deadline==original_deadline);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==1&&events[CV_CLOSED]==1&&state==WAITING&&deadline==0);
 // Already queued commands cannot run after the first successful recognition.
 utterance(command_pcm,48000,60,false,NULL);assert(events[CV_RECOGNIZED]==1);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==1);
 assert(clex_voice_play(42,playback_pcm,1600,60));assert(audio_busy);
 consume_utterance(wake_pcm);assert(events[CV_ACTIVATED]==1);
 assert(xQueueReceive(sounds,&request,0)==pdTRUE&&request.kind==SOUND_ACTION&&request.pcm==playback_pcm);
 sound=play_sound(request);assert(played_pcm==playback_pcm&&played_volume==60);complete_sound(&sound);
 assert(events[CV_TONE_DONE]==1&&last_tag==42&&!last_error&&state==WAITING&&deadline==0);
 // A new activation is accepted immediately after playback, before the old timeout.
 assert(mock_time<original_deadline);consume_utterance(wake_pcm);assert(state==CHIME&&events[CV_ACTIVATED]==2);
 assert(xQueueReceive(sounds,&request,0)==pdTRUE);sound=play_sound(request);complete_sound(&sound);assert(state==OPEN);
 mock_time=deadline;close_window();assert(state==WAITING&&events[CV_CLOSED]==2);
 close_window();assert(events[CV_CLOSED]==2);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==1);
 config.activation_sound=false;config.window_ms=5000;consume_utterance(wake_pcm);assert(state==OPEN&&events[CV_ACTIVATED]==3&&!audio_busy&&deadline==mock_time+5000000);
 assert(clex_voice_play(11,playback_pcm,1600,80));assert(xQueueReceive(sounds,&request,0)==pdTRUE);audio_status=ESP_FAIL;sound=play_sound(request);complete_sound(&sound);assert(last_tag==11&&last_error&&events[CV_TONE_DONE]==2);
 assert(!clex_voice_play(1,NULL,1600,50));assert(!clex_voice_play(1,playback_pcm,1600,101));
 assert(!clex_voice_play(1,playback_pcm,799,50));assert(!clex_voice_play(1,playback_pcm,80001,50));
 state=STOPPED;enabled=false;consume_utterance(wake_pcm);assert(events[CV_ACTIVATED]==3);
 config.custom_wake=false;state=WAITING;enabled=true;activate(cycle,epoch);assert(events[CV_ACTIVATED]==4&&mock_disable>0);
 unsigned enable_before=mock_enable;consume_utterance(command_pcm);
 assert(events[CV_RECOGNIZED]==2&&state==WAITING&&deadline==0&&mock_enable==enable_before+1);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==2);
 activate(cycle,epoch);assert(state==OPEN);consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==3&&state==WAITING);
 puts("PASS: custom wake, builtin wake, one command per activation, immediate reactivation, timeout only before a command, playback echo suppression and errors.");
 // A fast action confirmation must follow the recognition response, not be lost.
 audio_status=ESP_OK;config.custom_wake=true;config.recognition_pcm=playback_pcm;config.recognition_samples=1600;config.recognition_volume=55;
 state=WAITING;consume_utterance(wake_pcm);assert(state==OPEN);original_deadline=deadline;
 unsigned uncertain_before=events[CV_UNCERTAIN],recognized_before=events[CV_RECOGNIZED],done_before=events[CV_TONE_DONE];
 consume_utterance(wake_pcm);assert(events[CV_UNCERTAIN]==uncertain_before+1&&!audio_busy);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==recognized_before+1&&pending_sounds==1&&state==WAITING&&deadline==0);
 assert(clex_voice_play(77,playback_pcm,1600,80));assert(pending_sounds==2);
 unsigned activated_busy=events[CV_ACTIVATED];consume_utterance(wake_pcm);assert(events[CV_ACTIVATED]==activated_busy);
 assert(xQueueReceive(sounds,&request,0)==pdTRUE&&request.kind==SOUND_RECOGNITION);
 sound=play_sound(request);complete_sound(&sound);assert(played_volume==55&&audio_busy&&pending_sounds==1&&events[CV_TONE_DONE]==done_before);
 assert(xQueueReceive(sounds,&request,0)==pdTRUE&&request.kind==SOUND_ACTION&&request.tag==77);
 sound=play_sound(request);complete_sound(&sound);assert(!audio_busy&&pending_sounds==0&&last_tag==77&&events[CV_TONE_DONE]==done_before+1&&state==WAITING&&deadline==0);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==recognized_before+1);
 assert(mock_time<original_deadline);consume_utterance(wake_pcm);assert(state==OPEN&&!audio_busy);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==recognized_before+2);
 assert(xQueueReceive(sounds,&request,0)==pdTRUE);sound=play_sound(request);complete_sound(&sound);
 assert(state==WAITING);consume_utterance(wake_pcm);assert(state==OPEN);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==recognized_before+3);
 assert(xQueueReceive(sounds,&request,0)==pdTRUE);audio_status=ESP_FAIL;sound=play_sound(request);complete_sound(&sound);assert(state==WAITING&&!audio_busy);audio_status=ESP_OK;
 for(int i=0;i<SOUND_QUEUE_CAPACITY;i++)assert(clex_voice_play(100+i,playback_pcm,1600,80));
 assert(!clex_voice_play(200,playback_pcm,1600,80));
 for(int i=0;i<SOUND_QUEUE_CAPACITY;i++){assert(xQueueReceive(sounds,&request,0)==pdTRUE&&request.tag==100+i);sound=play_sound(request);complete_sound(&sound);assert(audio_busy==(i<SOUND_QUEUE_CAPACITY-1));}
 assert(!audio_busy&&pending_sounds==0);
 puts("PASS: rejection recovery, recognition response, queued action confirmation, immediate wake after the last sound, bounded FIFO and playback error recovery.");
 unsigned final_recognized=events[CV_RECOGNIZED];
 // Speech capture ignores waiting time and keeps the first syllable in pre-roll.
 static cv_capture_t onset;static int16_t spoken[52000],saved[48001];
 for(int i=0;i<52000;i++)spoken[i]=(int16_t)(i%2?1200:-1200);
 for(int partition=1;partition<=511;partition=partition==1?7:partition==7?320:511){
  cv_capture_begin(&onset,saved,48000,true);saved[48000]=1234;
  for(int second=0;second<5;second++)cv_capture_push(&onset,background_pcm,16000);
  assert(!onset.started&&onset.used==0);
  cv_capture_push(&onset,spoken,320);assert(!onset.started&&onset.used==0);
  cv_capture_push(&onset,background_pcm,640);assert(!onset.started);
  cv_capture_begin(&onset,saved,48000,true);
  cv_capture_push(&onset,background_pcm,16000);
  for(int i=0;i<52000;i+=partition){size_t n=52000-i<(int)partition?52000-i:partition;cv_capture_push(&onset,spoken+i,n);}
  assert(onset.started&&onset.used==48000&&saved[48000]==1234);
  for(int i=0;i<1280;i++)assert(saved[i]==0);
  assert(!memcmp(saved+1280,spoken,(48000-1280)*sizeof(int16_t)));
  if(partition==511)break;
 }
 cv_capture_begin(&onset,saved,48000,false);cv_capture_push(&onset,background_pcm,16000);assert(onset.used==16000&&onset.started);
 puts("PASS: speech onset ignores silence and isolated clicks, preserves pre-roll and first syllable, handles arbitrary chunks and leaves background capture timed.");
 // Exercise the real feed loop with microphone timeouts and an AFE error.
 feed_frames=512;size_t block_bytes=sizeof(input_block_t)+feed_frames*sizeof(int16_t);
 producer=malloc(block_bytes);consumer=malloc(block_bytes);endpoint=calloc(1,sizeof(*endpoint));recorder=calloc(1,sizeof(*recorder));
 input_queue=xQueueCreate(64,block_bytes);capture_requests=xQueueCreate(1,sizeof(capture_t));capture_results=xQueueCreate(1,sizeof(capture_t));
 state=WAITING;enabled=true;config.recognition_pcm=NULL;config.recognition_samples=0;config.recognition_volume=0;
 unsigned failed_before=events[CV_FAILED],drops_before=drops;uint32_t epoch_before=epoch;
 testing_feed=true;if(setjmp(feed_end)==0){feed_task(NULL);}testing_feed=false;free(feed_buffer);
 assert(audio_read_calls==8&&mock_feed_calls==5&&events[CV_FAILED]==failed_before+2);
 assert(drops==drops_before+2&&epoch==epoch_before+2&&state==WAITING&&enabled);
 // A recording must restart after a gap and contain only consecutive good blocks.
 int16_t recorded[1024];capture_t capture={.pcm=recorded,.count=1024},completed;
 assert(xQueueSend(capture_requests,&capture,0)==pdTRUE);recording=true;audio_read_calls=0;testing_feed=true;
 if(setjmp(feed_end)==0){feed_task(NULL);}
 testing_feed=false;recording=false;free(feed_buffer);
 assert(xQueueReceive(capture_results,&completed,0)==pdTRUE&&completed.pcm==recorded);
 for(int i=0;i<1024;i++)assert(recorded[i]==(i<512?4:5));
 capture=(capture_t){.pcm=recorded,.count=1024,.speech=true};
 assert(xQueueSend(capture_requests,&capture,0)==pdTRUE);recording=true;audio_read_calls=0;audio_read_limit=400;audio_time_step=32000;audio_faults=false;testing_feed=true;
 if(setjmp(feed_end)==0){feed_task(NULL);}
 testing_feed=false;recording=false;free(feed_buffer);
 assert(xQueueReceive(capture_results,&completed,0)==pdTRUE&&completed.error==CAPTURE_NO_SPEECH);
 audio_read_limit=7;audio_time_step=0;audio_faults=true;
 puts("PASS: silence timeout returns a capture result without publishing an empty recording or latching a capture fault.");
 // Wake detection remains enabled after a full day of simulated idle audio.
 for(int interval=0;interval<288;interval++){
  worker_mode=WAITING;worker_cycle=cycle;worker_epoch=epoch;
  for(int second=0;second<300;second++)kws_endpoint_push(endpoint,background_pcm,16000,utterance,NULL);
  mock_time+=300000000LL;close_window();assert(state==WAITING&&enabled);
 }
 unsigned activated_before=events[CV_ACTIVATED];
 worker_mode=WAITING;worker_cycle=cycle;worker_epoch=epoch;
 kws_endpoint_push(endpoint,wake_pcm,48000,utterance,NULL);assert(events[CV_ACTIVATED]==activated_before+1&&state==OPEN);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==final_recognized+1&&state==WAITING&&deadline==0);
 close_window();assert(state==WAITING);
 puts("PASS: feed loop survives repeated microphone timeouts and AFE error; custom wake and commands work after 24 hours of simulated idle audio.");
 // Model the ESP-IDF VFS default: every LF byte is expanded to CRLF.
 static int16_t transfer_pcm[48000];unsigned char *bytes=(unsigned char*)transfer_pcm;
 for(size_t i=0;i<sizeof(transfer_pcm);i++)bytes[i]=(unsigned char)i;
 for(int mode=ESP_LINE_ENDINGS_CRLF;mode<=ESP_LINE_ENDINGS_CR;mode++){
  mock_tx_mode=(esp_line_endings_t)mode;wire_size=0;capture_stdout=true;send_recording(transfer_pcm);capture_stdout=false;
  const char header[]="CLEX_VOICE_BEGIN 96000 16000 1 16 19cb8ac5\n",footer[]="\nCLEX_VOICE_END\n";
  assert(wire_size==sizeof(header)-1+sizeof(transfer_pcm)+sizeof(footer)-1);
  assert(!memcmp(wire,header,sizeof(header)-1));
  assert(!memcmp(wire+sizeof(header)-1,transfer_pcm,sizeof(transfer_pcm)));
  assert(!memcmp(wire+sizeof(header)-1+sizeof(transfer_pcm),footer,sizeof(footer)-1));
 }
 puts("PASS: binary voice recording preserves all 256 byte values, checksum and framing with CRLF, LF and CR console defaults.");
 return 0;
}
