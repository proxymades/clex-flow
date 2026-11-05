#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "features.h"
#define CV_CAPTURE_HISTORY (6*KWS_HOP)
typedef struct {
    int16_t *pcm;
    size_t capacity,used,frame_used,history_next;
    unsigned consecutive;
    bool started;
    int16_t frame[KWS_HOP],history[CV_CAPTURE_HISTORY];
} cv_capture_t;
void cv_capture_begin(cv_capture_t *capture,int16_t *pcm,size_t count,bool speech);
void cv_capture_push(cv_capture_t *capture,const int16_t *pcm,size_t count);
