#include "endpoint.h"
#include <string.h>
#define QUIET_FRAMES 16
size_t kws_endpoint_size(void){return sizeof(kws_endpoint_t);}
void kws_endpoint_reset(kws_endpoint_t *s) {
    s->frame_used=0;s->audio_count=0;s->history_next=0;s->consecutive=0;s->voiced=0;s->quiet=0;
    s->collecting=false;s->too_long=false;s->recovering=false;
    memset(s->history,0,sizeof(s->history));
}
void kws_endpoint_discard(kws_endpoint_t *s){kws_endpoint_reset(s);s->recovering=true;}
static void process_frame(kws_endpoint_t *s,kws_utterance_fn callback,void *context) {
    double sum=0,squares=0;
    for(unsigned i=0;i<KWS_HOP;++i){double x=s->frame[i];sum+=x;squares+=x*x;}
    double mean=sum/KWS_HOP;
    bool voice=squares/KWS_HOP-mean*mean>1600;
    memcpy(s->history[s->history_next],s->frame,sizeof(s->frame));
    s->history_next=(s->history_next+1)%KWS_HISTORY_FRAMES;
    if(s->recovering){
        s->quiet=voice?0:s->quiet+1;
        if(s->quiet>=QUIET_FRAMES){s->recovering=false;s->quiet=0;}
        return;
    }
    if(!s->collecting) {
        s->consecutive=voice?s->consecutive+1:0;
        if(s->consecutive>=2) {
            s->collecting=true;s->voiced=2;s->quiet=0;
            s->audio_count=KWS_HISTORY_FRAMES*KWS_HOP;
            for(unsigned i=0;i<KWS_HISTORY_FRAMES;++i)
                memcpy(s->audio+i*KWS_HOP,s->history[(s->history_next+i)%KWS_HISTORY_FRAMES],sizeof(s->frame));
        }
        return;
    }
    if(s->audio_count+KWS_HOP<=KWS_MAX_UTTERANCE) {
        memcpy(s->audio+s->audio_count,s->frame,sizeof(s->frame));
        s->audio_count+=KWS_HOP;
    } else s->too_long=true;
    if(voice){s->voiced++;s->quiet=0;}else s->quiet++;
    if(s->quiet>=QUIET_FRAMES){
        callback(s->audio,s->audio_count,s->voiced,s->too_long,context);
        s->collecting=false;s->too_long=false;s->audio_count=0;
        s->consecutive=0;s->voiced=0;s->quiet=0;
    }
}
void kws_endpoint_push(kws_endpoint_t *s,const int16_t *samples,size_t count,kws_utterance_fn callback,void *context) {
    for(size_t i=0;i<count;++i){
        s->frame[s->frame_used++]=samples[i];
        if(s->frame_used==KWS_HOP){s->frame_used=0;process_frame(s,callback,context);}
    }
}
