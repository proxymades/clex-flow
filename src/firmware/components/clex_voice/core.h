#pragma once
#include <stddef.h>
#include <stdint.h>
#include "features.h"
#define CV_COEFFS 12
#define CV_MAX_COMMANDS 32
#define CV_MAX_TEMPLATES 128
#define CV_SCALE 4096.0f
typedef struct { const int16_t *data; int frames; int label; float scale; } cv_template_t;
typedef struct { int label; int candidate; float distance; float ratio; } cv_result_t;
void cv_features_init(void);
int cv_encode(const int16_t *audio,size_t count,int background,float *encoded,int16_t *scratch,float *mel);
cv_result_t cv_classify(const float *encoded,int frames,const cv_template_t *references,size_t count,int commands,float threshold,float ratio);
