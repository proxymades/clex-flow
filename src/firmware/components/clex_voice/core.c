#include "core.h"
#include <math.h>
#include <string.h>
static float dct_weights[CV_COEFFS][KWS_MELS];
extern float kws_dtw(const float*,int,const float*,int,int,float,float);
void cv_features_init(void){
    kws_features_init();
    for(int k=0;k<CV_COEFFS;++k)for(int m=0;m<KWS_MELS;++m)
        dct_weights[k][m]=sqrtf(2.0f/KWS_MELS)*cosf(3.14159265358979323846f*(k+1)*(2*m+1)/(2*KWS_MELS));
}
int cv_encode(const int16_t *audio,size_t count,int background,float *encoded,int16_t *scratch,float *mel){
    if(!audio||!encoded||!scratch||!mel||count<KWS_FRAME||count>80000)return 0;
    int a=0,b=(int)count;
    if(!background){
        int first=-1,last=-1;
        for(size_t i=0;i+KWS_HOP<=count;i+=KWS_HOP){
            double sum=0,squares=0;
            for(int j=0;j<KWS_HOP;++j){double x=audio[i+j];sum+=x;squares+=x*x;}
            double mean=sum/KWS_HOP;
            if(squares/KWS_HOP-mean*mean>1600){if(first<0)first=(int)i;last=(int)i+KWS_HOP;}
        }
        if(first<0)return 0;
        a=first>1280?first-1280:0;b=last+1280<(int)count?last+1280:(int)count;
        if(b-a>KWS_SAMPLES)return 0;
    }else if(b>KWS_SAMPLES){a=(b-KWS_SAMPLES)/2;b=a+KWS_SAMPLES;}
    int length=b-a,begin=(KWS_SAMPLES-length)/2;
    memset(scratch,0,KWS_SAMPLES*sizeof(int16_t));
    memcpy(scratch+begin,audio+a,length*sizeof(int16_t));
    kws_features(scratch,mel);
    int lo=background?0:begin/KWS_HOP;
    int hi=background?KWS_FRAMES:(begin+length-KWS_FRAME)/KWS_HOP+1;
    if(hi>KWS_FRAMES)hi=KWS_FRAMES;
    int frames=hi-lo;if(frames<1)return 0;
    double sum=0,squares=0;
    for(int t=0;t<frames;++t)for(int k=0;k<CV_COEFFS;++k){
        float value=0;
        for(int m=0;m<KWS_MELS;++m)value+=mel[(lo+t)*KWS_MELS+m]*dct_weights[k][m];
        encoded[t*CV_COEFFS+k]=value;sum+=value;squares+=value*value;
    }
    int n=frames*CV_COEFFS;double mean=sum/n;
    float scale=sqrtf(fmaxf(0,(float)(squares/n-mean*mean)));if(scale<1e-4f)scale=1e-4f;
    for(int i=0;i<n;++i)encoded[i]/=scale;
    return frames;
}
cv_result_t cv_classify(const float *encoded,int frames,const cv_template_t *references,size_t count,int commands,float threshold,float max_ratio){
    cv_result_t result={.label=-1,.candidate=-1,.distance=1e9f,.ratio=1};
    if(!encoded||frames<1||frames>KWS_FRAMES||commands<1||commands>CV_MAX_COMMANDS||count>CV_MAX_TEMPLATES)return result;
    float distances[CV_MAX_COMMANDS+2];
    for(int i=0;i<commands+2;++i)distances[i]=1e9f;
    float decoded[KWS_FRAMES*CV_COEFFS];
    for(size_t i=0;i<count;++i){
        const cv_template_t *ref=&references[i];
        if(!ref->data||ref->label<0||ref->label>=commands+2||ref->frames<1||ref->frames>KWS_FRAMES)continue;
        float scale=ref->scale>0?ref->scale:CV_SCALE;
        for(int j=0;j<ref->frames*CV_COEFFS;++j)decoded[j]=ref->data[j]/scale;
        float score=kws_dtw(encoded,frames,decoded,ref->frames,CV_COEFFS,.3f,2.0f);
        if(score<distances[ref->label])distances[ref->label]=score;
    }
    int first=0,second=1;
    if(distances[second]<distances[first]){int t=first;first=second;second=t;}
    for(int i=2;i<commands+2;++i){
        if(distances[i]<distances[first]){second=first;first=i;}
        else if(distances[i]<distances[second])second=i;
    }
    result.candidate=first;result.distance=distances[first];
    result.ratio=distances[first]/fmaxf(distances[second],1e-9f);
    if(first<commands&&result.distance<=threshold&&result.ratio<=max_ratio)result.label=first;
    return result;
}
