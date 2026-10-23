// Capabilities belong to the module/platform description, not to the editor.
import {mqttSupported} from '../mqtt/model.js';
import {routerCapabilities} from '../router/model.js';
export function moduleSupportsBoard(module, board) {
 if(!module || !board || !module.compatibility?.targets.includes(board.target))return false;
 if((module.id==='clex.hardware.mqtt'||module.id.startsWith('clex.logic.mqtt-'))&&!mqttSupported(board))return false;
 if((module.id==='clex.hardware.router'||module.id==='clex.logic.router')&&!routerCapabilities(board).available)return false;
 if(board.platform==='esp-idf')return module.compatibility.espIdf===board.espIdfVersion;
 return module.compatibility.platforms?.[board.platform]===board.coreVersion;
}

export function moduleIsEventSource(module,node){
 const condition=module?.firmware?.eventSourceWhen;
 return Boolean(module?.firmware?.eventSource&&(!condition||(condition.values||[condition.value]).includes(node.parameters[condition.field])));
}
