import { hardwareProvider } from '../../../hardware/resources.js';
export function jd9365Dsi(project,catalog,component,display) {
 const board=catalog.boards.find(board=>board.id===project.boardId),module=catalog.modules.find(module=>module.id===component.moduleId),provider=hardwareProvider(component,module,board),p=display.initialization;
 if(!provider || !provider.displayControllers?.includes(display.controllerId))throw new Error('Выбранный DSI-интерфейс не поддерживает контроллер дисплея.');
 const commands=p.commands.map(command=>`  {${command.command},(uint8_t[]){${command.data.join(',')}},${command.data.length},${command.delayMs}},`).join('\n');
 return {features:['jd9365-dsi'],swapBytes:false,
 source:`#include "lvgl.h"
#include "esp_heap_caps.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_jd9365.h"
#include "esp_lcd_touch_gt911.h"
static esp_lcd_panel_handle_t clex_panel;
static esp_lcd_panel_io_handle_t clex_panel_io;
static esp_lcd_touch_handle_t clex_touch;
/* Waveshare 10.1-DSI-TOUCH-A initialization, Apache-2.0, source documented in module. */
static const jd9365_lcd_init_cmd_t clex_panel_commands[]={
${commands}
};
static void clex_panel_initialize(void) {
  i2c_device_config_t power_config={.dev_addr_length=I2C_ADDR_BIT_LEN_7,.device_address=${provider.backlightAddress},.scl_speed_hz=100000};
  i2c_master_dev_handle_t power; ESP_ERROR_CHECK(i2c_master_bus_add_device(clex_i2c_bus(${provider.i2c.port}),&power_config,&power));
  const uint8_t power_commands[][2]={{0x95,0x11},{0x95,0x17},{0x96,0},{${provider.backlightRegister},${Math.round(component.parameters.brightness*255/100)}}};
  for(size_t i=0;i<sizeof(power_commands)/sizeof(power_commands[0]);i++)ESP_ERROR_CHECK(i2c_master_transmit(power,power_commands[i],2,100));
  ESP_ERROR_CHECK(i2c_master_bus_rm_device(power));
  esp_lcd_dsi_bus_handle_t bus;
  esp_lcd_dsi_bus_config_t bus_config={.bus_id=0,.num_data_lanes=${p.laneCount},.phy_clk_src=MIPI_DSI_PHY_CLK_SRC_DEFAULT,.lane_bit_rate_mbps=${p.laneBitRateMbps}};
  ESP_ERROR_CHECK(esp_lcd_new_dsi_bus(&bus_config,&bus));
  esp_lcd_dbi_io_config_t io_config={.virtual_channel=0,.lcd_cmd_bits=8,.lcd_param_bits=8};
  ESP_ERROR_CHECK(esp_lcd_new_panel_io_dbi(bus,&io_config,&clex_panel_io));
  esp_lcd_dpi_panel_config_t dpi={.dpi_clk_src=MIPI_DSI_DPI_CLK_SRC_DEFAULT,.dpi_clock_freq_mhz=${p.dpiClockMHz},.virtual_channel=0,.pixel_format=LCD_COLOR_PIXEL_FORMAT_RGB565,.num_fbs=1,.video_timing={.h_size=${display.resolution.width},.v_size=${display.resolution.height},.hsync_pulse_width=${p.horizontalSync.pulse},.hsync_back_porch=${p.horizontalSync.backPorch},.hsync_front_porch=${p.horizontalSync.frontPorch},.vsync_pulse_width=${p.verticalSync.pulse},.vsync_back_porch=${p.verticalSync.backPorch},.vsync_front_porch=${p.verticalSync.frontPorch}},.flags.use_dma2d=true};
  jd9365_vendor_config_t vendor={.init_cmds=clex_panel_commands,.init_cmds_size=sizeof(clex_panel_commands)/sizeof(clex_panel_commands[0]),.mipi_config={.dsi_bus=bus,.dpi_config=&dpi,.lane_num=${p.laneCount}}};
  esp_lcd_panel_dev_config_t panel={.reset_gpio_num=${provider.resetGpio},.rgb_ele_order=LCD_RGB_ELEMENT_ORDER_RGB,.bits_per_pixel=16,.vendor_config=&vendor};
  ESP_ERROR_CHECK(esp_lcd_new_panel_jd9365(clex_panel_io,&panel,&clex_panel));
  ESP_ERROR_CHECK(esp_lcd_panel_reset(clex_panel)); ESP_ERROR_CHECK(esp_lcd_panel_init(clex_panel)); ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(clex_panel,true));
  esp_lcd_panel_io_i2c_config_t touch_io=ESP_LCD_TOUCH_IO_I2C_GT911_CONFIG();
  int touch_address=-1;
  const int addresses[]={${provider.touchAddresses.join(',')}};
  for(size_t i=0;i<sizeof(addresses)/sizeof(addresses[0]);i++) if(i2c_master_probe(clex_i2c_bus(${provider.i2c.port}),addresses[i],50)==ESP_OK){touch_address=addresses[i];break;}
  if(touch_address>=0){
    touch_io.dev_addr=touch_address;touch_io.scl_speed_hz=400000;
    esp_lcd_panel_io_handle_t touch_panel_io;
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_i2c(clex_i2c_bus(${provider.i2c.port}),&touch_io,&touch_panel_io));
    esp_lcd_touch_config_t touch_config={.x_max=${display.resolution.width},.y_max=${display.resolution.height},.rst_gpio_num=-1,.int_gpio_num=-1};
    ESP_ERROR_CHECK(esp_lcd_touch_new_i2c_gt911(touch_panel_io,&touch_config,&clex_touch));
  }else ESP_LOGW("CLEX_DSI","Touch controller not detected");
}
static void clex_touch_read(lv_indev_t *device,lv_indev_data_t *data){
  (void)device;data->state=LV_INDEV_STATE_RELEASED;
  if(!clex_touch || esp_lcd_touch_read_data(clex_touch)!=ESP_OK)return;
  uint16_t x[10],y[10],strength[10];uint8_t count=0;
  if(esp_lcd_touch_get_coordinates(clex_touch,x,y,strength,&count,10) && count){data->point.x=x[0];data->point.y=y[0];data->state=LV_INDEV_STATE_PRESSED;}
}
`,
 doneCallback:'static bool clex_graphics_done(esp_lcd_panel_handle_t panel, esp_lcd_dpi_panel_event_data_t *event, void *context) { (void)panel; (void)event; lv_display_flush_ready((lv_display_t *)context); return false; }',
 registerCallback:'  esp_lcd_dpi_panel_event_callbacks_t callbacks={.on_color_trans_done=clex_graphics_done};\n  ESP_ERROR_CHECK(esp_lcd_dpi_panel_register_event_callbacks(clex_panel,&callbacks,display));',
 initializeExtras:'  if(clex_touch){lv_indev_t *touch=lv_indev_create();lv_indev_set_type(touch,LV_INDEV_TYPE_POINTER);lv_indev_set_display(touch,display);lv_indev_set_read_cb(touch,clex_touch_read);}',
 };
}
