export function ov5647Csi(provider,slot) {
 const s='clex_camera_'+slot;
 return `#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include "linux/videodev2.h"
#include "esp_video_init.h"
#include "esp_video_device.h"
#include "esp_video_ioctl.h"
static QueueHandle_t ${s}_commands;
static int ${s}_fd=-1;
static void *${s}_buffers[2];static size_t ${s}_sizes[2];static uint32_t ${s}_width,${s}_height;
static esp_err_t ${s}_initialize_device(void){
 esp_video_init_csi_config_t csi={.sccb_config={.init_sccb=false,.i2c_handle=clex_i2c_bus(${provider.i2c.port}),.freq=100000},.reset_pin=${provider.resetGpio},.pwdn_pin=${provider.powerdownGpio},.dont_init_ldo=true};
 esp_video_init_config_t config={.csi=&csi};
 esp_err_t result=esp_video_init_with_flags(&config,ESP_VIDEO_INIT_FLAGS_MIPI_CSI|ESP_VIDEO_INIT_FLAGS_ISP);if(result!=ESP_OK)return result;
 ${s}_fd=open(ESP_VIDEO_MIPI_CSI_DEVICE_NAME,O_RDONLY);if(${s}_fd<0)return ESP_FAIL;
 struct timeval timeout={.tv_sec=3};if(ioctl(${s}_fd,VIDIOC_S_DQBUF_TIMEOUT,&timeout)!=0)return ESP_FAIL;
 struct v4l2_format format={.type=V4L2_BUF_TYPE_VIDEO_CAPTURE};
 if(ioctl(${s}_fd,VIDIOC_G_FMT,&format)!=0)return ESP_FAIL;
 format.fmt.pix.pixelformat=V4L2_PIX_FMT_RGB565;
 if(ioctl(${s}_fd,VIDIOC_S_FMT,&format)!=0)return ESP_FAIL;
 if(ioctl(${s}_fd,VIDIOC_G_FMT,&format)!=0)return ESP_FAIL;
 ${s}_width=format.fmt.pix.width;${s}_height=format.fmt.pix.height;
 struct v4l2_requestbuffers request={.count=2,.type=V4L2_BUF_TYPE_VIDEO_CAPTURE,.memory=V4L2_MEMORY_MMAP};
 if(ioctl(${s}_fd,VIDIOC_REQBUFS,&request)!=0 || request.count!=2)return ESP_FAIL;
 for(unsigned i=0;i<2;i++){
  struct v4l2_buffer buffer={.index=i,.type=V4L2_BUF_TYPE_VIDEO_CAPTURE,.memory=V4L2_MEMORY_MMAP};
  if(ioctl(${s}_fd,VIDIOC_QUERYBUF,&buffer)!=0)return ESP_FAIL;
  ${s}_sizes[i]=buffer.length;${s}_buffers[i]=mmap(NULL,buffer.length,PROT_READ|PROT_WRITE,MAP_SHARED,${s}_fd,buffer.m.offset);
  if(${s}_buffers[i]==MAP_FAILED)return ESP_ERR_NO_MEM;
  if(ioctl(${s}_fd,VIDIOC_QBUF,&buffer)!=0)return ESP_FAIL;
 }
 int type=V4L2_BUF_TYPE_VIDEO_CAPTURE;return ioctl(${s}_fd,VIDIOC_STREAMON,&type)==0?ESP_OK:ESP_FAIL;
}
static void ${s}_cleanup(void){
 if(${s}_fd>=0){int type=V4L2_BUF_TYPE_VIDEO_CAPTURE;ioctl(${s}_fd,VIDIOC_STREAMOFF,&type);close(${s}_fd);${s}_fd=-1;}
 for(unsigned i=0;i<2;i++)if(${s}_buffers[i] && ${s}_buffers[i]!=MAP_FAILED){munmap(${s}_buffers[i],${s}_sizes[i]);${s}_buffers[i]=NULL;}
}
static void ${s}_worker(void *arg){
 (void)arg;esp_err_t initialized=${s}_initialize_device();if(initialized!=ESP_OK)${s}_cleanup();
 clex_media_command_t command;uint32_t count=0;
 for(;;){
  bool requested=xQueueReceive(${s}_commands,&command,initialized==ESP_OK?0:portMAX_DELAY)==pdTRUE;
  clex_media_snapshot_t value={.frames=count};esp_err_t result=initialized;
  if(result==ESP_OK){
   struct v4l2_buffer buffer={.type=V4L2_BUF_TYPE_VIDEO_CAPTURE,.memory=V4L2_MEMORY_MMAP};
   if(ioctl(${s}_fd,VIDIOC_DQBUF,&buffer)!=0)result=errno==EAGAIN?ESP_ERR_TIMEOUT:ESP_FAIL;
   else {
    if(buffer.index>=2 || buffer.bytesused>${s}_sizes[buffer.index])result=ESP_ERR_INVALID_SIZE;
    else if(requested){value.width=${s}_width;value.height=${s}_height;value.bytes=buffer.bytesused;value.frames=++count;}
    if(ioctl(${s}_fd,VIDIOC_QBUF,&buffer)!=0)result=ESP_FAIL;
   }
  }
  if(!requested){if(result!=ESP_OK)vTaskDelay(pdMS_TO_TICKS(100));continue;}
  value.success=result==ESP_OK;if(result!=ESP_OK)snprintf(value.error,sizeof(value.error),"Camera: %s",esp_err_to_name(result));
  ESP_LOGI("CLEX_CAMERA","node=%u success=%d width=%lu height=%lu bytes=%lu error=%s",command.node,value.success,(unsigned long)value.width,(unsigned long)value.height,(unsigned long)value.bytes,value.error);
  clex_media_publish(command.node,&value);
 }
}
static void ${s}_start(void){
 ${s}_commands=xQueueCreate(4,sizeof(clex_media_command_t));
 if(!${s}_commands || xTaskCreate(${s}_worker,"clex_camera",8192,NULL,4,NULL)!=pdPASS){ESP_LOGE("CLEX_CAMERA","Cannot start camera worker");abort();}
}
static bool ${s}_request(uint16_t node){clex_media_command_t command={.node=node};return xQueueSend(${s}_commands,&command,0)==pdTRUE;}
`;
}
