#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef struct {float previous,highpass;bool initialized;} cv_adc_filter_t;
int16_t cv_pcm_scale(float value,float gain);
int16_t cv_adc_to_pcm(unsigned raw,unsigned bits,float gain,cv_adc_filter_t *filter);
int16_t cv_i2s_to_pcm(const int32_t frame[2],bool right,float gain);
