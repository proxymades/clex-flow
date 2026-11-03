#include "voice-runtime-support.h"
#include "runtime.c"
#include <math.h>
static unsigned events[CV_TONE_DONE+1];
static int last_tag;
static bool last_error;
static const int16_t *played_pcm;
static size_t played_samples;
static unsigned played_volume;
static esp_err_t audio_status=ESP_OK;
static void on_event(const clex_voice_event_t *event){events[event->type]++;last_tag=event->tag;last_error=event->error[0]!=0;}
esp_err_t cv_audio_initialize(const clex_voice_config_t *settings){(void)settings;return ESP_OK;}
esp_err_t cv_audio_read(int16_t *pcm,size_t samples){memset(pcm,0,samples*sizeof(int16_t));return ESP_OK;}
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
 sounds=xQueueCreate(1,sizeof(sound_request_t));state=WAITING;enabled=true;
 consume_utterance(command_pcm);assert(events[CV_ACTIVATED]==0&&events[CV_RECOGNIZED]==0&&events[CV_UNCERTAIN]==0);
 consume_utterance(wake_pcm);assert(state==CHIME&&audio_busy&&events[CV_ACTIVATED]==1&&deadline==0);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==0);
 sound_request_t request;assert(xQueueReceive(sounds,&request,0)==pdTRUE&&request.chime);
 sound_result_t sound=play_sound(request);assert(played_pcm==playback_pcm&&played_samples==1600&&played_volume==85);
 complete_sound(&sound);assert(state==OPEN&&!audio_busy);assert(deadline==sound.ended+20000000);
 int64_t original_deadline=deadline;
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==1&&deadline==original_deadline);
 assert(clex_voice_play(42,playback_pcm,1600,60));assert(audio_busy);assert(!clex_voice_play(43,playback_pcm,1600,60));
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==1);
 assert(xQueueReceive(sounds,&request,0)==pdTRUE&&!request.chime&&request.pcm==playback_pcm);
 sound=play_sound(request);assert(played_pcm==playback_pcm&&played_volume==60);complete_sound(&sound);
 assert(events[CV_TONE_DONE]==1&&last_tag==42&&!last_error&&deadline==original_deadline);
 // Audio queued before playback cannot produce an event after completion.
 utterance(command_pcm,48000,60,false,NULL);assert(events[CV_RECOGNIZED]==1);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==2&&deadline==original_deadline);
 consume_utterance(wake_pcm);assert(events[CV_ACTIVATED]==1&&events[CV_UNCERTAIN]==1);
 mock_time=original_deadline;close_window();assert(state==WAITING&&events[CV_CLOSED]==1);
 consume_utterance(command_pcm);assert(events[CV_RECOGNIZED]==2&&events[CV_UNCERTAIN]==1);
 config.activation_sound=false;consume_utterance(wake_pcm);assert(state==OPEN&&events[CV_ACTIVATED]==2&&!audio_busy&&deadline==mock_time+20000000);
 assert(clex_voice_play(11,playback_pcm,1600,80));assert(xQueueReceive(sounds,&request,0)==pdTRUE);audio_status=ESP_FAIL;sound=play_sound(request);complete_sound(&sound);assert(last_tag==11&&last_error&&events[CV_TONE_DONE]==2);
 assert(!clex_voice_play(1,NULL,1600,50));assert(!clex_voice_play(1,playback_pcm,1600,101));
 assert(!clex_voice_play(1,playback_pcm,799,50));assert(!clex_voice_play(1,playback_pcm,80001,50));
 state=STOPPED;enabled=false;consume_utterance(wake_pcm);assert(events[CV_ACTIVATED]==2);
 config.custom_wake=false;state=WAITING;enabled=true;activate(cycle,epoch);assert(events[CV_ACTIVATED]==3&&mock_disable>0);
 assert(mock_enable==0);puts("PASS: custom wake, negative speech, activation audio, 20-second window, repeated commands, playback echo suppression, completion and errors.");
 return 0;
}
