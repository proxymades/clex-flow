import { hardwareProvider } from '../../hardware/resources.js';
export function peripheralBuses(project,catalog) {
 const board=catalog.boards.find(board=>board.id===project.boardId);
 const providers=project.components.filter(component=>catalog.modules.find(module=>module.id===component.moduleId)?.hardwareInterface?.family!=='display' || project.logic.nodes.some(node=>node.parameters.componentId===component.id && catalog.modules.find(module=>module.id===node.moduleId)?.editor==='screen')).map(component=>hardwareProvider(component,catalog.modules.find(module=>module.id===component.moduleId),board)).filter(Boolean);
 if(!providers.length)return {source:'',initialize:''};
 const buses=[...new Map(providers.filter(p=>p.i2c).map(p=>[p.i2c.port,p.i2c])).values()];
 const ldos=[...new Map(providers.filter(p=>p.ldo).map(p=>[p.ldo.channel,p.ldo])).values()];
 const source=`#include "driver/i2c_master.h"
${ldos.length?'#include "esp_ldo_regulator.h"':''}
static struct { int port, sda, scl; i2c_master_bus_handle_t handle; } clex_i2c_buses[] = {
${buses.map(p=>`  {${p.port},${p.sda},${p.scl},NULL},`).join('\n')}
};
static i2c_master_bus_handle_t clex_i2c_bus(int port) {
  for(size_t i=0;i<sizeof(clex_i2c_buses)/sizeof(clex_i2c_buses[0]);i++) if(clex_i2c_buses[i].port==port)return clex_i2c_buses[i].handle;
  return NULL;
}
static void clex_peripheral_buses_initialize(void) {
  for(size_t i=0;i<sizeof(clex_i2c_buses)/sizeof(clex_i2c_buses[0]);i++) {
    i2c_master_bus_config_t config={.i2c_port=clex_i2c_buses[i].port,.sda_io_num=clex_i2c_buses[i].sda,.scl_io_num=clex_i2c_buses[i].scl,.clk_source=I2C_CLK_SRC_DEFAULT,.glitch_ignore_cnt=7,.flags.enable_internal_pullup=true};
    ESP_ERROR_CHECK(i2c_new_master_bus(&config,&clex_i2c_buses[i].handle));
  }
${ldos.map((p,i)=>`  static esp_ldo_channel_handle_t phy_${i};\n  esp_ldo_channel_config_t phy_config_${i}={.chan_id=${p.channel},.voltage_mv=${p.voltageMv}};\n  ESP_ERROR_CHECK(esp_ldo_acquire_channel(&phy_config_${i},&phy_${i}));`).join('\n')}
}
`;
 return {source,initialize:'  clex_peripheral_buses_initialize();'};
}
