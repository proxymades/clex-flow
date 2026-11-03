#include "microphone_pcm.h"
int16_t cv_pcm_scale(float value,float gain){
    value*=gain;
    return value>32767?32767:value<-32768?-32768:(int16_t)value;
}
int16_t cv_adc_to_pcm(unsigned raw,unsigned bits,float gain,cv_adc_filter_t *filter){
    if(!filter||bits<1||bits>16)return 0;
    float value=((int)raw-(1<<(bits-1)))*(1<<(16-bits));
    if(!filter->initialized){filter->previous=value;filter->initialized=true;}
    filter->highpass=value-filter->previous+.995f*filter->highpass;
    filter->previous=value;
    return cv_pcm_scale(filter->highpass,gain);
}
int16_t cv_i2s_to_pcm(const int32_t frame[2],bool right,float gain){
    return cv_pcm_scale(frame[right?1:0]>>16,gain);
}
