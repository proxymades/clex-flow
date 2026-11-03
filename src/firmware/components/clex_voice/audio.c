#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_heap_caps.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "audio.h"
#include "chime_pcm.h"
#define SAMPLE_RATE 16000
#define AMP_PIN amplifier_pin
static int amplifier_pin;
static esp_codec_dev_handle_t codec;

static int16_t chime_pcm[CHIME_SAMPLES];
esp_err_t cv_audio_initialize(const clex_voice_config_t *config)
{
    amplifier_pin=config->amplifier;
    gpio_config_t amplifier = {.pin_bit_mask = 1ULL << AMP_PIN, .mode = GPIO_MODE_OUTPUT};
    ESP_RETURN_ON_ERROR(gpio_config(&amplifier), "audio_probe", "amplifier GPIO");
    gpio_set_level(AMP_PIN, 0);
    i2c_master_bus_handle_t bus=config->bus;
    ESP_RETURN_ON_ERROR(i2c_master_probe(bus,config->address,100),"CLEX_VOICE","Audio codec not found");

    i2s_chan_config_t channel = I2S_CHANNEL_DEFAULT_CONFIG(config->i2s_port, I2S_ROLE_MASTER);
    channel.dma_desc_num = 4;
    channel.dma_frame_num = 256;
    channel.auto_clear = true;
    i2s_chan_handle_t tx, rx;
    ESP_RETURN_ON_ERROR(i2s_new_channel(&channel, &tx, &rx), "audio_probe", "I2S channels");
    i2s_std_config_t format = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {.mclk = config->mclk, .bclk = config->bclk, .ws = config->ws,
                     .dout = config->dout, .din = config->din}
    };
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(tx, &format), "audio_probe", "I2S TX");
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(rx, &format), "audio_probe", "I2S RX");
    audio_codec_i2s_cfg_t data_config = {.port = config->i2s_port, .tx_handle = tx, .rx_handle = rx};
    audio_codec_i2c_cfg_t control_config = {.port = config->i2s_port, .addr = config->address*2, .bus_handle = bus};
    const audio_codec_data_if_t *data = audio_codec_new_i2s_data(&data_config);
    const audio_codec_ctrl_if_t *control = audio_codec_new_i2c_ctrl(&control_config);
    const audio_codec_gpio_if_t *gpio = audio_codec_new_gpio();
    if (!data || !control || !gpio) return ESP_ERR_NO_MEM;
    es8311_codec_cfg_t codec_config = {
        .ctrl_if = control, .gpio_if = gpio, .codec_mode = ESP_CODEC_DEV_WORK_MODE_BOTH,
        .pa_pin = AMP_PIN, .use_mclk = true, .digital_mic = false, .no_dac_ref = true,
        .hw_gain = {.pa_voltage = 5.0, .codec_dac_voltage = 3.3}
    };
    const audio_codec_if_t *chip = es8311_codec_new(&codec_config);
    if (!chip) return ESP_ERR_NO_MEM;
    esp_codec_dev_cfg_t device = {.codec_if = chip, .data_if = data, .dev_type = ESP_CODEC_DEV_TYPE_IN_OUT};
    codec = esp_codec_dev_new(&device);
    if (!codec) return ESP_ERR_NO_MEM;
    esp_codec_dev_sample_info_t sample = {.sample_rate = SAMPLE_RATE, .channel = 1, .bits_per_sample = 16};
    if (esp_codec_dev_open(codec, &sample) != 0) return ESP_FAIL;
    if (esp_codec_dev_set_in_gain(codec, config->gain_db) != 0) return ESP_FAIL;
    if (esp_codec_dev_set_out_vol(codec, config->volume) != 0) return ESP_FAIL;
    gpio_set_level(AMP_PIN, 0);
    chime_pcm_fill(chime_pcm);
    return ESP_OK;
}

esp_err_t cv_audio_chime(unsigned volume) {
    if(esp_codec_dev_set_out_vol(codec,volume)!=0)return ESP_FAIL;
    gpio_set_level(AMP_PIN,1);
    int status=esp_codec_dev_write(codec,chime_pcm,sizeof(chime_pcm));
    vTaskDelay(pdMS_TO_TICKS(64));gpio_set_level(AMP_PIN,0);
    return status==0?ESP_OK:ESP_FAIL;
}
esp_err_t cv_audio_tone(unsigned frequency,unsigned duration,unsigned volume) {
    if(esp_codec_dev_set_out_vol(codec,volume)!=0)return ESP_FAIL;
    gpio_set_level(AMP_PIN,1);
    unsigned total=duration*16,phase=0;int16_t pcm[256];esp_err_t result=ESP_OK;
    for(unsigned offset=0;offset<total;){
        unsigned count=total-offset<256?total-offset:256;
        for(unsigned i=0;i<count;++i){phase=(phase+frequency)%16000;int triangle=phase<8000?(int)phase:16000-(int)phase;pcm[i]=(int16_t)((triangle-4000)*2);}
        if(esp_codec_dev_write(codec,pcm,count*sizeof(int16_t))!=0){result=ESP_FAIL;break;}offset+=count;
    }
    memset(pcm,0,sizeof(pcm));esp_codec_dev_write(codec,pcm,sizeof(pcm));
    vTaskDelay(pdMS_TO_TICKS(64));gpio_set_level(AMP_PIN,0);return result;
}
esp_err_t cv_audio_read(int16_t *samples,size_t count){return esp_codec_dev_read(codec,samples,count*sizeof(int16_t))==0?ESP_OK:ESP_FAIL;}
esp_err_t cv_audio_gain(unsigned gain){return esp_codec_dev_set_in_gain(codec,gain)==0?ESP_OK:ESP_FAIL;}
