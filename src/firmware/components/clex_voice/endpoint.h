#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "features.h"
#define KWS_HISTORY_FRAMES 6
#define KWS_MAX_UTTERANCE 48000
typedef struct {
    int16_t frame[KWS_HOP],history[KWS_HISTORY_FRAMES][KWS_HOP],audio[KWS_MAX_UTTERANCE];
    size_t frame_used,audio_count;
    unsigned history_next,consecutive,voiced,quiet;
    bool collecting,too_long,recovering;
} kws_endpoint_t;
typedef void (*kws_utterance_fn)(const int16_t *audio,size_t count,unsigned voiced,bool too_long,void *context);
size_t kws_endpoint_size(void);
void kws_endpoint_reset(kws_endpoint_t *state);
void kws_endpoint_discard(kws_endpoint_t *state);
void kws_endpoint_push(kws_endpoint_t *state,const int16_t *samples,size_t count,kws_utterance_fn callback,void *context);
