import { hardwareProvider } from '../../hardware/resources.js';
import { es8311I2s } from './esp-idf/es8311-i2s.js';
import { ov5647Csi } from './esp-idf/ov5647-csi.js';
export const MEDIA_TYPES='enum { CLEX_EVENT_MEDIA=3 };\ntypedef struct { bool success; uint32_t frames,width,height,bytes; char error[128]; } clex_media_snapshot_t;\ntypedef struct { uint16_t node; uint32_t frequency_hz,duration_ms; unsigned volume; } clex_media_command_t;';
const drivers={'esp-idf':{'es8311-i2s':es8311I2s,'ov5647-csi':ov5647Csi}};
export function mediaFirmware(project,catalog,nodes,index) {
 const board=catalog.boards.find(board=>board.id===project.boardId),components=project.components.filter(component=>['audio','camera'].includes(catalog.modules.find(module=>module.id===component.moduleId)?.hardwareInterface?.family));
 const owned=nodes.filter(node=>['clex.logic.tone','clex.logic.camera-capture'].includes(node.moduleId));
 if(!components.length)return {enabled:false,source:'',initialize:'',features:[],expressions:new Map(),textSizes:new Map(),dispatch:[],eventModules:new Set(),operations:new Map()};
 const expressions=new Map(),textSizes=new Map(),operations=new Map();
 const variables=owned.map(node=>{const i=index.get(node.id),name='media_value_'+i;expressions.set(node.id,{success:name+'.success',error:name+'.error',frames:name+'.frames',width:name+'.width',height:name+'.height',bytes:name+'.bytes'});textSizes.set(node.id,{error:128});return `static clex_media_snapshot_t ${name};`;});
 const sources=components.map((component,slot)=>{
  const module=catalog.modules.find(module=>module.id===component.moduleId),provider=hardwareProvider(component,module,board),driver=drivers[board.platform]?.[provider?.driverKey];if(!driver)throw new Error('Нет драйвера выбранного аппаратного интерфейса.');
  for(const node of owned.filter(node=>node.parameters.componentId===component.id)){
   const i=index.get(node.id),p=node.parameters;
   const request=provider.family==='audio'?`clex_audio_${slot}_request(${i},${p.frequencyHz},${p.durationMs},${p.volume})`:`clex_camera_${slot}_request(${i})`;
   operations.set(node.id,`  if(!${request}){media_value_${i}.success=false;snprintf(media_value_${i}.error,sizeof(media_value_${i}.error),"Device busy: command queue full");node_${i}_emit_changed();node_${i}_emit_failed();}`);
  }
  return driver(provider,slot);
 });
 const publish=`static void clex_media_publish(uint16_t node,const clex_media_snapshot_t *snapshot){clex_flow_event_t event={.node=node,.kind=CLEX_EVENT_MEDIA};event.payload.media=*snapshot;xQueueSend(timer_queue,&event,portMAX_DELAY);}`;
 const dispatch=owned.map(node=>{const i=index.get(node.id);return `        case ${i}: if(event.kind==CLEX_EVENT_MEDIA){media_value_${i}=event.payload.media;node_${i}_emit_changed();if(media_value_${i}.success)node_${i}_emit_done();else node_${i}_emit_failed();}break;`;});
 return {enabled:true,source:[...variables,publish,...sources].join('\n'),initialize:components.map((c,i)=>'  clex_'+(catalog.modules.find(m=>m.id===c.moduleId).hardwareInterface.family==='audio'?'audio':'camera')+'_'+i+'_start();').join('\n'),features:[...new Set(components.map(c=>catalog.modules.find(m=>m.id===c.moduleId).hardwareInterface.family==='audio'?'audio-es8311':'camera-ov5647'))],expressions,textSizes,dispatch,eventModules:new Set(['clex.logic.tone','clex.logic.camera-capture']),operations};
}
