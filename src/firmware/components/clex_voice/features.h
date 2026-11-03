#pragma once
#include <stdint.h>
#define KWS_RATE 16000
#define KWS_SAMPLES 38400
#define KWS_FRAME 400
#define KWS_HOP 320
#define KWS_FFT 512
#define KWS_MELS 32
#define KWS_FRAMES (1 + (KWS_SAMPLES - KWS_FRAME) / KWS_HOP)
#ifdef __cplusplus
extern "C" {
#endif
void kws_features_init(void);
void kws_features(const int16_t *pcm, float *output);
#ifdef __cplusplus
}
#endif
