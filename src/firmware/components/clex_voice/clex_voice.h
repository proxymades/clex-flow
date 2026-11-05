#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "driver/i2c_master.h"
#include "core.h"
enum { CV_MIC_CODEC,CV_MIC_ADC,CV_MIC_I2S };
enum { CV_ACTIVATED=1,CV_RECOGNIZED,CV_UNCERTAIN,CV_CLOSED,CV_FAILED,CV_TONE_DONE };
typedef struct { int type,command,tag; char error[96]; } clex_voice_event_t;
typedef struct {
    i2c_master_bus_handle_t bus;
    int i2s_port,address,mclk,bclk,ws,dout,din,amplifier;
    int mic_kind,mic_gpio,mic_i2s_port,mic_bclk,mic_ws,mic_data;
    bool mic_right,speaker_enabled,activation_sound;
    unsigned gain_db,activation_volume,window_ms;
    const int16_t *activation_pcm;
    size_t activation_samples;
    const int16_t *recognition_pcm;
    size_t recognition_samples;
    unsigned recognition_volume;
    const cv_template_t *references;
    size_t reference_count;
    int commands;
    const char **command_ids;
    const char *signature;
    float threshold,ratio;
    bool custom_wake;
    const cv_template_t *wake_references;
    size_t wake_reference_count;
    float wake_threshold,wake_ratio;
    void (*on_event)(const clex_voice_event_t*);
} clex_voice_config_t;
esp_err_t clex_voice_start(const clex_voice_config_t *config);
bool clex_voice_tone(int tag,unsigned frequency,unsigned duration,unsigned volume);
bool clex_voice_play(int tag,const int16_t *pcm,size_t samples,unsigned volume);
