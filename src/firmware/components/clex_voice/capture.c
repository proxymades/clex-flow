#include "capture.h"
#include <string.h>
void cv_capture_begin(cv_capture_t *capture,int16_t *pcm,size_t count,bool speech){
    memset(capture,0,sizeof(*capture));capture->pcm=pcm;capture->capacity=count;capture->started=!speech;
}
void cv_capture_push(cv_capture_t *capture,const int16_t *pcm,size_t count){
    for(size_t i=0;i<count&&capture->used<capture->capacity;++i){
        if(capture->started){capture->pcm[capture->used++]=pcm[i];continue;}
        capture->history[capture->history_next]=pcm[i];capture->history_next=(capture->history_next+1)%CV_CAPTURE_HISTORY;
        capture->frame[capture->frame_used++]=pcm[i];
        if(capture->frame_used<KWS_HOP)continue;
        capture->frame_used=0;double sum=0,squares=0;
        for(size_t j=0;j<KWS_HOP;++j){double value=capture->frame[j];sum+=value;squares+=value*value;}
        double mean=sum/KWS_HOP;
        capture->consecutive=squares/KWS_HOP-mean*mean>1600?capture->consecutive+1:0;
        if(capture->consecutive<2)continue;
        capture->started=true;
        for(size_t j=0;j<CV_CAPTURE_HISTORY&&capture->used<capture->capacity;++j)
            capture->pcm[capture->used++]=capture->history[(capture->history_next+j)%CV_CAPTURE_HISTORY];
    }
}
