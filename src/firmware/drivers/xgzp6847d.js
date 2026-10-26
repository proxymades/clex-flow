import {isXgzp, XGZP_LOGIC, i2cSignals} from '../../pressure/model.js';
import {XGZP_RUNTIME} from './xgzp6847d-runtime.js';

export function xgzpFirmware(project,catalog,nodes,index) {
  const board=catalog.boards.find(b=>b.id===project.boardId),avr=board.platform==='arduino-avr';
  const sensors=project.components.filter(isXgzp).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const blocks=nodes.filter(n=>n.moduleId===XGZP_LOGIC);
  const expressions=new Map(),textSizes=new Map(),textGlyphs=new Map(),operations=new Map();
  if(!sensors.length)return {enabled:false,expressions,textSizes,textGlyphs,operations,headers:'',source:'',initialize:'',poll:'',notify:'',features:[],ram:0};
  const clock=avr?'now':'(uint32_t)(esp_timer_get_time()/1000)';
  for(const node of blocks) {
    const i=index.get(node.id),slot=sensors.findIndex(c=>c.id===node.parameters.componentId),name='xgzp_value_'+i;
    expressions.set(node.id,Object.fromEntries(['pressure','pressurePa','temperature','valid','text','temperatureText','error'].map(port=>[port,name+'.'+port])));
    textSizes.set(node.id,{text:32,temperatureText:32,error:48});
    textGlyphs.set(node.id,'0123456789.- Па кПа бар мм рт. ст. PSI °CНет данных');
    operations.set(node.id,`  clex_xgzp_request(&clex_xgzp_sensors[${slot}], &${name});`);
  }
  const transport=avr?String.raw`
static bool clex_xgzp_write(uint8_t slot,uint8_t reg,uint8_t value) {
  (void)slot; Wire.beginTransmission(0x6d); Wire.write(reg); Wire.write(value);
  return Wire.endTransmission()==0;
}
static bool clex_xgzp_read(uint8_t slot,uint8_t reg,uint8_t *bytes,uint8_t count) {
  (void)slot; Wire.beginTransmission(0x6d); Wire.write(reg);
  if(Wire.endTransmission(false)!=0)return false;
  if(Wire.requestFrom((uint8_t)0x6d,count)!=(size_t)count)return false;
  for(uint8_t i=0;i<count;i++)bytes[i]=(uint8_t)Wire.read();
  return true;
}
`:`static i2c_master_dev_handle_t clex_xgzp_devices[${sensors.length}];
static bool clex_xgzp_write(uint8_t slot,uint8_t reg,uint8_t value) {
  uint8_t bytes[]={reg,value};
  return clex_xgzp_devices[slot] && i2c_master_transmit(clex_xgzp_devices[slot],bytes,2,20)==ESP_OK;
}
static bool clex_xgzp_read(uint8_t slot,uint8_t reg,uint8_t *bytes,uint8_t count) {
  return clex_xgzp_devices[slot] && i2c_master_transmit_receive(clex_xgzp_devices[slot],&reg,1,bytes,count,20)==ESP_OK;
}
`;
  const source=transport+XGZP_RUNTIME+`\nstatic clex_xgzp_sensor_t clex_xgzp_sensors[] = {\n${sensors.map((c,i)=>'  {.slot='+i+', .k='+c.parameters.kFactor+', .pressure=NAN, .temperature=NAN},').join('\n')}\n};\n`+blocks.map(n=>'static clex_xgzp_value_t xgzp_value_'+index.get(n.id)+' = {.pressure=NAN,.pressurePa=NAN,.temperature=NAN,.text="Нет данных",.temperatureText="Нет данных"};').join('\n');
  const initialize=avr?'  Wire.begin(); Wire.setClock(100000); Wire.setWireTimeout(25000, true);':sensors.map((c,i)=>{
    const {sda,scl}=i2cSignals(c,project);
    return `  { i2c_master_bus_handle_t bus=clex_i2c_bus(${c.parameters.i2cPort});
    if(bus){ i2c_device_config_t config={.dev_addr_length=I2C_ADDR_BIT_LEN_7,.device_address=0x6d,.scl_speed_hz=100000};
      esp_err_t error=i2c_master_bus_add_device(bus,&config,&clex_xgzp_devices[${i}]);
      if(error!=ESP_OK)ESP_LOGE("CLEX_XGZP","I2C${c.parameters.i2cPort} SDA${sda}/SCL${scl}: %s",esp_err_to_name(error));
    }
  }`;
  }).join('\n');
  const poll=`  for(size_t sensor=0;sensor<${sensors.length};sensor++)clex_xgzp_poll(&clex_xgzp_sensors[sensor],${clock});\n`+blocks.map(n=>{
    const i=index.get(n.id),slot=sensors.findIndex(c=>c.id===n.parameters.componentId),name='xgzp_value_'+i,unit=['Pa','kPa','bar','mmHg','psi'].indexOf(n.parameters.unit);
    const auto=n.parameters.autoRead?`    if(!${name}.waiting && (!${name}.scheduled || (uint32_t)(${clock}-${name}.due)>=${n.parameters.intervalMs}UL)){${name}.scheduled=true;${name}.due=${clock};node_${i}();}\n`:'';
    return `  { if(${name}.waiting && ${name}.generation==clex_xgzp_sensors[${slot}].generation){
      clex_xgzp_snapshot(&${name},&clex_xgzp_sensors[${slot}],${unit});
${avr?'':`      if(!${name}.valid)ESP_LOGW("CLEX_XGZP","Sensor ${slot}: %s",${name}.error);\n`}      node_${i}_emit_changed();
      if(${name}.valid)node_${i}_emit_done();else node_${i}_emit_failed();
    }
${auto}  }`;
  }).join('\n');
  return {enabled:true,expressions,textSizes,textGlyphs,operations,source,initialize,poll,
    headers:avr?'#include <Wire.h>\n#include <math.h>':'#include <math.h>',features:avr?[]:['xgzp6847d-'+board.target],ram:blocks.length*140+sensors.length*32+240,
  };
}
