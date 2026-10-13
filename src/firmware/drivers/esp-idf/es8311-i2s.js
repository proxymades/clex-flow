export function es8311I2s(provider,slot) {
 const p=provider.signals,s='clex_audio_'+slot;
 return `#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
static QueueHandle_t ${s}_commands;
static esp_codec_dev_handle_t ${s}_codec;
static i2s_chan_handle_t ${s}_tx;
static esp_err_t ${s}_initialize_device(void) {
  i2s_chan_config_t channel=I2S_CHANNEL_DEFAULT_CONFIG(${provider.i2sPort},I2S_ROLE_MASTER);
  channel.dma_desc_num=3;channel.dma_frame_num=256;
  esp_err_t result=i2s_new_channel(&channel,&${s}_tx,NULL);if(result!=ESP_OK)return result;
  i2s_std_config_t config={.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000),.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_MONO),.gpio_cfg={.mclk=${p.mclk},.bclk=${p.bclk},.ws=${p.ws},.dout=${p.dout},.din=-1}};
  if((result=i2s_channel_init_std_mode(${s}_tx,&config))!=ESP_OK)return result;
  audio_codec_i2s_cfg_t data_config={.port=${provider.i2sPort},.tx_handle=${s}_tx};
  const audio_codec_data_if_t *data=audio_codec_new_i2s_data(&data_config);
  audio_codec_i2c_cfg_t control_config={.port=${provider.i2c.port},.addr=${provider.i2cAddress*2},.bus_handle=clex_i2c_bus(${provider.i2c.port})};
  const audio_codec_ctrl_if_t *control=audio_codec_new_i2c_ctrl(&control_config);
  const audio_codec_gpio_if_t *gpio=audio_codec_new_gpio();
  if(!data || !control || !gpio)return ESP_ERR_NO_MEM;
  es8311_codec_cfg_t codec_config={.ctrl_if=control,.gpio_if=gpio,.codec_mode=ESP_CODEC_DEV_WORK_MODE_DAC,.pa_pin=${p.amplifierEnable},.use_mclk=true,.hw_gain={.pa_voltage=5.0,.codec_dac_voltage=3.3}};
  const audio_codec_if_t *codec=es8311_codec_new(&codec_config);if(!codec)return ESP_ERR_NO_MEM;
  esp_codec_dev_cfg_t device={.codec_if=codec,.data_if=data,.dev_type=ESP_CODEC_DEV_TYPE_OUT};
  ${s}_codec=esp_codec_dev_new(&device);if(!${s}_codec)return ESP_ERR_NO_MEM;
  esp_codec_dev_sample_info_t format={.sample_rate=16000,.channel=1,.bits_per_sample=16};
  return esp_codec_dev_open(${s}_codec,&format)==0?ESP_OK:ESP_FAIL;
}
static void ${s}_worker(void *arg){
 (void)arg;esp_err_t initialized=${s}_initialize_device();clex_media_command_t command;
 for(;;){
  if(xQueueReceive(${s}_commands,&command,portMAX_DELAY)!=pdTRUE)continue;
  clex_media_snapshot_t value={0};esp_err_t result=initialized;
  if(result==ESP_OK && esp_codec_dev_set_out_vol(${s}_codec,command.volume)!=0)result=ESP_FAIL;
  uint32_t samples=command.duration_ms*16U, phase=0;int16_t pcm[256];
  for(uint32_t offset=0;result==ESP_OK && offset<samples;){
   uint32_t count=samples-offset<256?samples-offset:256;
   for(uint32_t j=0;j<count;j++){phase=(phase+command.frequency_hz)%16000;int32_t triangle=phase<8000?(int32_t)phase:(int32_t)(16000-phase);pcm[j]=(int16_t)((triangle*8000/8000)-4000);}
   if(esp_codec_dev_write(${s}_codec,pcm,count*sizeof(int16_t))!=0)result=ESP_FAIL;
   offset+=count;
  }
  if(result==ESP_OK){memset(pcm,0,sizeof(pcm));if(esp_codec_dev_write(${s}_codec,pcm,sizeof(pcm))!=0)result=ESP_FAIL;else vTaskDelay(pdMS_TO_TICKS(64));}
  value.success=result==ESP_OK;if(result!=ESP_OK)snprintf(value.error,sizeof(value.error),"Audio: %s",esp_err_to_name(result));
  ESP_LOGI("CLEX_AUDIO","node=%u success=%d error=%s",command.node,value.success,value.error);
  clex_media_publish(command.node,&value);
 }
}
static void ${s}_start(void){
 ${s}_commands=xQueueCreate(4,sizeof(clex_media_command_t));
 if(!${s}_commands || xTaskCreate(${s}_worker,"clex_audio",6144,NULL,4,NULL)!=pdPASS){ESP_LOGE("CLEX_AUDIO","Cannot start audio worker");abort();}
}
static bool ${s}_request(uint16_t node,uint32_t frequency,uint32_t duration,unsigned volume){
 clex_media_command_t command={.node=node,.frequency_hz=frequency,.duration_ms=duration,.volume=volume};return xQueueSend(${s}_commands,&command,0)==pdTRUE;
}
`;
}
