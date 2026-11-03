#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "driver/i2c_master.h"
#include "core.h"
enum { CV_ACTIVATED=1,CV_RECOGNIZED,CV_UNCERTAIN,CV_CLOSED,CV_FAILED,CV_TONE_DONE };
typedef struct { int type,command,tag; char error[96]; } clex_voice_event_t;
typedef struct {
    i2c_master_bus_handle_t bus;
    int i2s_port,address,mclk,bclk,ws,dout,din,amplifier;
    unsigned gain_db,volume,window_ms;
    const cv_template_t *references;
    size_t reference_count;
    int commands;
    const char **command_ids;
    const char *signature;
    float threshold,ratio;
    void (*on_event)(const clex_voice_event_t*);
} clex_voice_config_t;
esp_err_t clex_voice_start(const clex_voice_config_t *config);
bool clex_voice_tone(int tag,unsigned frequency,unsigned duration,unsigned volume);
