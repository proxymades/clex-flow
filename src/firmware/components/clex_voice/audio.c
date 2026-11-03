#include <math.h>
#include <string.h>
#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_adc/adc_continuous.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_check.h"
#include "soc/soc_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "audio.h"
#include "microphone_pcm.h"
#include "chime_pcm.h"
#define SAMPLE_RATE 16000
#define AMP_PIN amplifier_pin
static int amplifier_pin,input_kind;
static bool output_enabled,mic_right;
static esp_codec_dev_handle_t codec;
static i2s_chan_handle_t microphone_rx;
static adc_continuous_handle_t microphone_adc;
static union {uint32_t alignment;uint8_t bytes[1024];} adc_raw;
static size_t adc_used,adc_available;
static float input_gain=1;
static cv_adc_filter_t adc_filter;
static portMUX_TYPE gain_lock=portMUX_INITIALIZER_UNLOCKED;
static int16_t chime_pcm[CHIME_SAMPLES];
static esp_err_t codec_initialize(const clex_voice_config_t *config,bool capture){
    if(!config->bus||config->i2s_port<0)return ESP_ERR_INVALID_ARG;
    amplifier_pin=config->amplifier;
    if(output_enabled){
        if(amplifier_pin<0)return ESP_ERR_INVALID_ARG;
        gpio_config_t amplifier={.pin_bit_mask=1ULL<<AMP_PIN,.mode=GPIO_MODE_OUTPUT};
        ESP_RETURN_ON_ERROR(gpio_config(&amplifier),"CLEX_AUDIO","amplifier GPIO");gpio_set_level(AMP_PIN,0);
    }
    ESP_RETURN_ON_ERROR(i2c_master_probe(config->bus,config->address,100),"CLEX_AUDIO","Audio codec not found");
    i2s_chan_config_t channel=I2S_CHANNEL_DEFAULT_CONFIG(config->i2s_port,I2S_ROLE_MASTER);
    channel.dma_desc_num=4;channel.dma_frame_num=256;channel.auto_clear=true;
    i2s_chan_handle_t tx=NULL,rx=NULL;
    ESP_RETURN_ON_ERROR(i2s_new_channel(&channel,output_enabled?&tx:NULL,capture?&rx:NULL),"CLEX_AUDIO","I2S codec channels");
    i2s_std_config_t format={.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_MONO),.gpio_cfg={.mclk=config->mclk,.bclk=config->bclk,.ws=config->ws,.dout=output_enabled?config->dout:-1,.din=capture?config->din:-1}};
    if(tx)ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(tx,&format),"CLEX_AUDIO","Codec TX");
    if(rx)ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(rx,&format),"CLEX_AUDIO","Codec RX");
    audio_codec_i2s_cfg_t data_config={.port=config->i2s_port,.tx_handle=tx,.rx_handle=rx};
    audio_codec_i2c_cfg_t control_config={.port=config->i2s_port,.addr=config->address*2,.bus_handle=config->bus};
    const audio_codec_data_if_t *data=audio_codec_new_i2s_data(&data_config);
    const audio_codec_ctrl_if_t *control=audio_codec_new_i2c_ctrl(&control_config);
    const audio_codec_gpio_if_t *gpio=audio_codec_new_gpio();
    if(!data||!control||!gpio)return ESP_ERR_NO_MEM;
    es8311_codec_cfg_t chip_config={.ctrl_if=control,.gpio_if=gpio,.codec_mode=capture?(output_enabled?ESP_CODEC_DEV_WORK_MODE_BOTH:ESP_CODEC_DEV_WORK_MODE_ADC):ESP_CODEC_DEV_WORK_MODE_DAC,.pa_pin=output_enabled?AMP_PIN:-1,.use_mclk=true,.digital_mic=false,.no_dac_ref=true,.hw_gain={.pa_voltage=5.0,.codec_dac_voltage=3.3}};
    const audio_codec_if_t *chip=es8311_codec_new(&chip_config);if(!chip)return ESP_ERR_NO_MEM;
    esp_codec_dev_cfg_t device={.codec_if=chip,.data_if=data,.dev_type=capture?(output_enabled?ESP_CODEC_DEV_TYPE_IN_OUT:ESP_CODEC_DEV_TYPE_IN):ESP_CODEC_DEV_TYPE_OUT};
    codec=esp_codec_dev_new(&device);if(!codec)return ESP_ERR_NO_MEM;
    esp_codec_dev_sample_info_t sample={.sample_rate=SAMPLE_RATE,.channel=1,.bits_per_sample=16};
    if(esp_codec_dev_open(codec,&sample)!=0)return ESP_FAIL;
    if(output_enabled){if(esp_codec_dev_set_out_vol(codec,config->activation_volume)!=0)return ESP_FAIL;gpio_set_level(AMP_PIN,0);chime_pcm_fill(chime_pcm);}
    return ESP_OK;
}
static esp_err_t adc_initialize(const clex_voice_config_t *config){
    adc_unit_t unit;adc_channel_t channel;
    ESP_RETURN_ON_ERROR(adc_continuous_io_to_channel(config->mic_gpio,&unit,&channel),"CLEX_MIC","ADC pin");
    if(unit!=ADC_UNIT_1)return ESP_ERR_NOT_SUPPORTED;
    adc_continuous_handle_cfg_t handle={.max_store_buf_size=16384,.conv_frame_size=1024,.flags.flush_pool=1};
    ESP_RETURN_ON_ERROR(adc_continuous_new_handle(&handle,&microphone_adc),"CLEX_MIC","ADC handle");
    adc_digi_pattern_config_t pattern={.atten=ADC_ATTEN_DB_12,.channel=channel,.unit=unit,.bit_width=SOC_ADC_DIGI_MAX_BITWIDTH};
    adc_continuous_config_t format={.sample_freq_hz=SAMPLE_RATE,.conv_mode=ADC_CONV_SINGLE_UNIT_1,.format=ADC_DIGI_OUTPUT_FORMAT_TYPE2,.pattern_num=1,.adc_pattern=&pattern};
    ESP_RETURN_ON_ERROR(adc_continuous_config(microphone_adc,&format),"CLEX_MIC","ADC format");
    return adc_continuous_start(microphone_adc);
}
static esp_err_t i2s_initialize(const clex_voice_config_t *config){
    if(config->mic_i2s_port<0||config->mic_bclk<0||config->mic_ws<0||config->mic_data<0)return ESP_ERR_INVALID_ARG;
    i2s_chan_config_t channel=I2S_CHANNEL_DEFAULT_CONFIG(config->mic_i2s_port,I2S_ROLE_MASTER);
    channel.dma_desc_num=4;channel.dma_frame_num=256;
    ESP_RETURN_ON_ERROR(i2s_new_channel(&channel,NULL,&microphone_rx),"CLEX_MIC","I2S microphone");
    // INMP441 requires 64 BCLK periods per frame: two 32-bit slots.
    i2s_std_config_t format={.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO),.gpio_cfg={.mclk=-1,.bclk=config->mic_bclk,.ws=config->mic_ws,.dout=-1,.din=config->mic_data}};
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(microphone_rx,&format),"CLEX_MIC","I2S format");
    mic_right=config->mic_right;
    return i2s_channel_enable(microphone_rx);
}
esp_err_t cv_audio_initialize(const clex_voice_config_t *config){
    input_kind=config->mic_kind;output_enabled=config->speaker_enabled;
    if(input_kind==CV_MIC_CODEC||output_enabled)ESP_RETURN_ON_ERROR(codec_initialize(config,input_kind==CV_MIC_CODEC),"CLEX_AUDIO","Codec initialization");
    if(input_kind==CV_MIC_ADC)ESP_RETURN_ON_ERROR(adc_initialize(config),"CLEX_MIC","Analog microphone");
    else if(input_kind==CV_MIC_I2S)ESP_RETURN_ON_ERROR(i2s_initialize(config),"CLEX_MIC","Digital microphone");
    else if(input_kind!=CV_MIC_CODEC)return ESP_ERR_INVALID_ARG;
    return cv_audio_gain(config->gain_db);
}
esp_err_t cv_audio_read(int16_t *samples,size_t count){
    if(input_kind==CV_MIC_CODEC)return esp_codec_dev_read(codec,samples,count*sizeof(int16_t))==0?ESP_OK:ESP_FAIL;
    portENTER_CRITICAL(&gain_lock);float gain=input_gain;portEXIT_CRITICAL(&gain_lock);
    size_t used=0;
    while(used<count){
        if(input_kind==CV_MIC_I2S){
            int32_t raw[256];size_t frames=count-used<128?count-used:128,bytes=0;
            esp_err_t status=i2s_channel_read(microphone_rx,raw,frames*8,&bytes,1000);
            if(status!=ESP_OK){return status;}if(!bytes||bytes%8)return ESP_FAIL;
            for(size_t i=0;i<bytes/8;++i)samples[used++]=cv_i2s_to_pcm(raw+i*2,mic_right,gain);
        }else{
            if(adc_used>=adc_available){uint32_t bytes=0;esp_err_t status=adc_continuous_read(microphone_adc,adc_raw.bytes,sizeof(adc_raw.bytes),&bytes,1000);if(status!=ESP_OK){return status;}if(!bytes||bytes%SOC_ADC_DIGI_RESULT_BYTES)return ESP_FAIL;adc_used=0;adc_available=bytes;}
            const adc_digi_output_data_t *result=(const adc_digi_output_data_t*)(adc_raw.bytes+adc_used);adc_used+=SOC_ADC_DIGI_RESULT_BYTES;
            samples[used++]=cv_adc_to_pcm(result->type2.data,SOC_ADC_DIGI_MAX_BITWIDTH,gain,&adc_filter);
        }
    }
    return ESP_OK;
}
esp_err_t cv_audio_gain(unsigned gain){
    if(gain>42||gain%6)return ESP_ERR_INVALID_ARG;
    if(input_kind==CV_MIC_CODEC)return esp_codec_dev_set_in_gain(codec,gain)==0?ESP_OK:ESP_FAIL;
    float factor=powf(10.0f,gain/20.0f);portENTER_CRITICAL(&gain_lock);input_gain=factor;portEXIT_CRITICAL(&gain_lock);return ESP_OK;
}
esp_err_t cv_audio_chime(unsigned volume,const int16_t *pcm,size_t samples) {
    if(!output_enabled)return ESP_ERR_INVALID_STATE;
    if(esp_codec_dev_set_out_vol(codec,volume)!=0)return ESP_FAIL;
    gpio_set_level(AMP_PIN,1);
    if(!pcm){pcm=chime_pcm;samples=CHIME_SAMPLES;}
    esp_err_t result=ESP_OK;int16_t buffer[256];
    for(size_t offset=0;offset<samples;){
        size_t count=samples-offset<256?samples-offset:256;
        memcpy(buffer,pcm+offset,count*sizeof(int16_t));
        if(esp_codec_dev_write(codec,buffer,count*sizeof(int16_t))!=0){result=ESP_FAIL;break;}
        offset+=count;
    }
    memset(buffer,0,sizeof(buffer));
    if(esp_codec_dev_write(codec,buffer,sizeof(buffer))!=0)result=ESP_FAIL;
    vTaskDelay(pdMS_TO_TICKS(64));gpio_set_level(AMP_PIN,0);
    return result;
}
esp_err_t cv_audio_tone(unsigned frequency,unsigned duration,unsigned volume) {
    if(!output_enabled)return ESP_ERR_INVALID_STATE;
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
