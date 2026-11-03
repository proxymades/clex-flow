import {voiceProject} from './voice-fixture.js';
import {catalog} from './catalog-fixture.js';
import {addHardware,connectTerminal,connectionProblem} from '../src/assembly/model.js';
import {microphoneSource} from '../src/microphone/model.js';
import {readVoiceProfile,voiceSignature} from '../src/voice/model.js';
export const MICROPHONE_BOARDS=['waveshare-esp32-p4-nano','waveshare-esp32-s3-eth','espressif-devkitc-1-v1-1-n8r8'];
export function microphoneProject(boardId=MICROPHONE_BOARDS[0],chip='max9814',{trained=true,speaker=false,camera='disconnected'}={}){
 let p=voiceProject({trained,speaker,activationSound:speaker});
 const board=catalog.boards.find(b=>b.id===boardId),voice=p.components[0];
 p={...p,boardId,boardSettings:Object.fromEntries(Object.entries(board.options||{}).map(([key,value])=>[key,value.default]))};
 if(board.options?.camera)p.boardSettings.camera=camera;
 voice.parameters.interfaceId=board.peripherals?.find(provider=>provider.driverKey==='es8311-i2s')?.id||'';
 p=addHardware(p,catalog.modules.find(m=>m.id==='clex.hardware.'+chip),catalog);
 const mic=p.components.at(-1),module=catalog.modules.find(m=>m.id===mic.moduleId);
 voice.parameters.microphoneId=mic.id;voice.parameters.gainDb=chip==='inmp441'?18:0;
 for(const terminal of module.terminals){
  const candidates=board.pins.filter(pin=>!connectionProblem(p,catalog,mic.id,terminal.id,pin.id));
  const pin=candidates[0];if(!pin)throw Error(boardId+': no suitable pin for '+chip+'/'+terminal.id);
  p=connectTerminal(p,catalog,mic.id,terminal.id,pin.id);
 }
 const profile=readVoiceProfile(voice);profile.inputKey=microphoneSource(p,voice,board).key;
 if(profile.model)profile.model.signature=voiceSignature(profile);
 voice.parameters.profile=JSON.stringify(profile);
 return p;
}
