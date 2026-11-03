import {VOICE_MODULE,VOICE_LOGIC,readVoiceProfile,voiceModelReady,voiceSignature,decodeVoiceFeatures} from '../../voice/model.js';
import {hardwareProvider} from '../../hardware/resources.js';
export const VOICE_TYPES='#include "clex_voice.h"\nenum { CLEX_EVENT_VOICE=10 };';
export function voiceFirmware(project,catalog,nodes,index,cString){
  const component=project.components.find(c=>c.moduleId===VOICE_MODULE),expressions=new Map(),textSizes=new Map(),textGlyphs=new Map(),operations=new Map();
  const empty={enabled:false,expressions,textSizes,textGlyphs,operations,source:'',initialize:'',dispatch:[],features:[],eventModules:new Set()};
  if(!component)return empty;
  const board=catalog.boards.find(b=>b.id===project.boardId),definition=catalog.modules.find(m=>m.id===VOICE_MODULE),provider=hardwareProvider(component,definition,board);
  if(!provider||provider.driverKey!=='es8311-i2s'||!Number.isInteger(provider.signals.din))throw Error('Для голосового компонента нужен микрофон и кодек ES8311.');
  const profile=readVoiceProfile(component),ready=voiceModelReady(profile),commands=profile.commands,p=provider.signals;
  const blocks=nodes.filter(n=>n.moduleId===VOICE_LOGIC&&n.parameters.componentId===component.id),tones=nodes.filter(n=>n.moduleId==='clex.logic.tone'&&n.parameters.componentId===component.id);
  const references=ready?profile.model.referenceIds.map(id=>profile.samples.find(s=>s.id===id)):[];
  const commandIndex=new Map(commands.map((c,i)=>[c.id,i]));
  const arrays=references.map((s,i)=>'static const int16_t voice_reference_'+i+'[] = {'+decodeVoiceFeatures(s).join(',')+'};').join('\n');
  const referenceTable=references.length?'static const cv_template_t voice_references[] = {\n'+references.map((s,i)=>'{voice_reference_'+i+','+s.frames+','+(s.kind==='command'?commandIndex.get(s.commandId):commands.length+(s.kind==='background'?1:0))+','+(s.scale??4096)+'}').join(',\n')+'\n};':'static const cv_template_t *voice_references = NULL;';
  const ids=commands.length?commands.map(c=>cString(c.id)).join(','):cString('');
  const phraseCases=commands.map((c,i)=>'case '+i+': return '+cString(c.phrase)+';').join('');
  const idCases=commands.map((c,i)=>'case '+i+': return '+cString(c.id)+';').join('');
  const values=blocks.map(n=>{
    const i=index.get(n.id),name='voice_value_'+i;
    expressions.set(n.id,{phrase:'voice_phrase('+name+'.command)',commandId:'voice_command_id('+name+'.command)',error:name+'.error'});
    textSizes.set(n.id,{phrase:Math.max(1,...commands.map(c=>new TextEncoder().encode(c.phrase).length+1)),commandId:37,error:96});
    textGlyphs.set(n.id,commands.map(c=>c.phrase).join('')+'Ошибка голосового компонента');
    return 'static clex_voice_event_t '+name+' = {.command=-1};';
  });
  for(const n of tones){const i=index.get(n.id),name='voice_tone_'+i;values.push('static struct {bool success;char error[96];} '+name+';');expressions.set(n.id,{success:name+'.success',error:name+'.error'});textSizes.set(n.id,{error:96});operations.set(n.id,`  if(!clex_voice_tone(${i},${n.parameters.frequencyHz},${n.parameters.durationMs},${n.parameters.volume})){${name}.success=false;snprintf(${name}.error,sizeof(${name}.error),"Audio is busy");node_${i}_emit_changed();node_${i}_emit_failed();}`);}
  const source=`${arrays}
${referenceTable}
static const char *voice_command_ids[] = {${ids}};
static const char * __attribute__((unused)) voice_phrase(int command){switch(command){${phraseCases}default:return "";}}
static const char * __attribute__((unused)) voice_command_id(int command){switch(command){${idCases}default:return "";}}
${values.join('\n')}
static void voice_publish(const clex_voice_event_t *snapshot){
 if(snapshot->type==CV_TONE_DONE){clex_flow_event_t event={.node=snapshot->tag,.kind=CLEX_EVENT_VOICE};event.payload.voice=*snapshot;if(xQueueSend(timer_queue,&event,0)!=pdTRUE)atomic_fetch_add(&dropped_events,1);}
 ${blocks.length?'else{'+blocks.map(n=>'{clex_flow_event_t event={.node='+index.get(n.id)+',.kind=CLEX_EVENT_VOICE};event.payload.voice=*snapshot;if(xQueueSend(timer_queue,&event,0)!=pdTRUE)atomic_fetch_add(&dropped_events,1);}').join('')+'}':''}
}
static void voice_initialize(void){
 clex_voice_config_t setup={.bus=clex_i2c_bus(${provider.i2c.port}),.i2s_port=${provider.i2sPort},.address=${provider.i2cAddress},.mclk=${p.mclk},.bclk=${p.bclk},.ws=${p.ws},.dout=${p.dout},.din=${p.din},.amplifier=${p.amplifierEnable},.gain_db=${component.parameters.gainDb},.volume=${component.parameters.volume},.window_ms=${component.parameters.windowMs},.references=voice_references,.reference_count=${references.length},.commands=${ready?commands.length:0},.command_ids=voice_command_ids,.signature=${cString(ready?voiceSignature(profile):'none')},.threshold=${ready?profile.model.threshold:0.3},.ratio=${ready?profile.model.ratio:0.97},.on_event=voice_publish};
 esp_err_t error=clex_voice_start(&setup);
 if(error!=ESP_OK){ESP_LOGE("CLEX_VOICE","Initialization failed: %s",esp_err_to_name(error));clex_voice_event_t event={.type=CV_FAILED,.command=-1};snprintf(event.error,sizeof(event.error),"Voice: %s",esp_err_to_name(error));voice_publish(&event);}
}
`;
  const dispatch=blocks.map(n=>{const i=index.get(n.id);return `case ${i}: if(event.kind==CLEX_EVENT_VOICE){voice_value_${i}=event.payload.voice;switch(voice_value_${i}.type){case CV_RECOGNIZED: switch(voice_value_${i}.command){${commands.map((c,j)=>'case '+j+': node_'+i+'_emit_command_'+c.id.replaceAll('-','')+'(); break;').join('')}default:break;}node_${i}_emit_recognized();break;case CV_ACTIVATED:node_${i}_emit_activated();break;case CV_UNCERTAIN:node_${i}_emit_uncertain();break;case CV_CLOSED:node_${i}_emit_closed();break;case CV_FAILED:node_${i}_emit_failed();break;default:break;}}break;`;});
  for(const n of tones){const i=index.get(n.id);dispatch.push(`case ${i}: if(event.kind==CLEX_EVENT_VOICE){voice_tone_${i}.success=!event.payload.voice.error[0];snprintf(voice_tone_${i}.error,sizeof(voice_tone_${i}.error),"%s",event.payload.voice.error);node_${i}_emit_changed();if(voice_tone_${i}.success)node_${i}_emit_done();else node_${i}_emit_failed();}break;`);}
  return {enabled:true,expressions,textSizes,textGlyphs,operations,source,initialize:'  voice_initialize();',dispatch,features:['voice-p4'],eventModules:new Set([VOICE_LOGIC,...(tones.length?['clex.logic.tone']:[])])};
}
