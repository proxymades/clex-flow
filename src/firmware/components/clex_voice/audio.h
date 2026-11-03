#pragma once
#include "clex_voice.h"
esp_err_t cv_audio_initialize(const clex_voice_config_t *config);
esp_err_t cv_audio_read(int16_t *samples,size_t count);
esp_err_t cv_audio_chime(unsigned volume,const int16_t *pcm,size_t samples);
esp_err_t cv_audio_tone(unsigned frequency,unsigned duration,unsigned volume);
esp_err_t cv_audio_gain(unsigned gain);
