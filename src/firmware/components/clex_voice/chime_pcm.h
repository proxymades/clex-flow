#pragma once
#include <stddef.h>
#include <stdint.h>
#define CHIME_RATE 16000U
#define CHIME_LEAD_SAMPLES (80U * 16U)
#define CHIME_LOW_SAMPLES (180U * 16U)
#define CHIME_GAP_SAMPLES (140U * 16U)
#define CHIME_HIGH_SAMPLES (220U * 16U)
#define CHIME_TAIL_SAMPLES (96U * 16U)
#define CHIME_SAMPLES (CHIME_LEAD_SAMPLES + CHIME_LOW_SAMPLES + CHIME_GAP_SAMPLES + CHIME_HIGH_SAMPLES + CHIME_TAIL_SAMPLES)
static inline int16_t chime_tone_sample(unsigned index, unsigned length, unsigned frequency) {
    const unsigned ramp = 8U * 16U;
    unsigned phase = (index * frequency) % CHIME_RATE;
    int triangle = phase < CHIME_RATE / 2 ? (int)phase : (int)(CHIME_RATE - phase);
    int sample = (triangle - (int)CHIME_RATE / 4) * 2;
    unsigned gain = index < ramp ? index : ramp;
    if (length - 1 - index < gain) gain = length - 1 - index;
    return (int16_t)(sample * (int)gain / (int)ramp);
}
static inline void chime_pcm_fill(int16_t *pcm) {
    const unsigned low_start = CHIME_LEAD_SAMPLES;
    const unsigned high_start = low_start + CHIME_LOW_SAMPLES + CHIME_GAP_SAMPLES;
    for (unsigned i = 0; i < CHIME_SAMPLES; ++i) {
        if (i >= low_start && i < low_start + CHIME_LOW_SAMPLES)
            pcm[i] = chime_tone_sample(i - low_start, CHIME_LOW_SAMPLES, 660);
        else if (i >= high_start && i < high_start + CHIME_HIGH_SAMPLES)
            pcm[i] = chime_tone_sample(i - high_start, CHIME_HIGH_SAMPLES, 990);
        else pcm[i] = 0;
    }
}
