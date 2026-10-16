export const ESPNOW_MODULE='clex.hardware.espnow';
export const MAX_PEERS=20;
export const MAX_ENCRYPTED_PEERS=6;
export const MAX_TEXT_BYTES=160;
export const MAC_PATTERN=/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
export const keyValid=value=>typeof value==='string'&&/^[0-9a-f]{32}$/i.test(value);
export function macValid(mac){return typeof mac==='string'&&MAC_PATTERN.test(mac)&&!(parseInt(mac.slice(0,2),16)&1)&&!/^00(?::00){5}$/.test(mac);}
export function readPeers(component){try{const value=JSON.parse(component?.parameters.peers||'[]');return Array.isArray(value)?value.filter(peer=>peer&&typeof peer==='object'&&!Array.isArray(peer)).map((peer,i)=>({...peer,id:typeof peer.id==='string'?peer.id:'invalid-'+i,name:typeof peer.name==='string'?peer.name:'',mac:typeof peer.mac==='string'?peer.mac:'',lmk:typeof peer.lmk==='string'?peer.lmk:''})):[];}catch{return [];}}
export function newKey(){return [...crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function espNowSupported(board){return board?.platform==='esp-idf'&&board.radio?.espNow===true;}
export function espNowIssues(component,board){
 const p=component.parameters,errors=[];
 if(!espNowSupported(board))errors.push('Для этой платы нет доступного ESP-NOW-радиоинтерфейса.');
 if(!Number.isInteger(p.channel)||p.channel<1||p.channel>11)errors.push('Выберите канал Wi-Fi от 1 до 11.');
 if(typeof p.encryption!=='boolean'||typeof p.allowModeChange!=='boolean')errors.push('Неверные переключатели ESP-NOW.');
 if(p.encryption&&!keyValid(p.pmk))errors.push('PMK должен содержать 32 шестнадцатеричных символа (16 байт).');
 if(!['normal','lr'].includes(p.mode)||p.mode==='lr'&&!board.radio?.longRange)errors.push('Выберите доступный режим радио.');
 if(!Number.isInteger(p.timeoutMs)||p.timeoutMs<100||p.timeoutMs>30000||!Number.isInteger(p.retries)||p.retries<0||p.retries>5)errors.push('Таймаут: 100-30000 мс; повторов: 0-5.');
 let peers;try{peers=JSON.parse(p.peers);}catch{errors.push('Поврежден список удаленных устройств.');return errors;}
 if(!Array.isArray(peers)||peers.length>MAX_PEERS){errors.push('Можно добавить до 20 удаленных устройств.');return errors;}
 const ids=new Set(),macs=new Set();let encrypted=0;
 for(const peer of peers){
  if(!peer||typeof peer.id!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(peer.id)||ids.has(peer.id)||typeof peer.name!=='string'||!peer.name.trim()||peer.name.length>40||!macValid(peer.mac)||macs.has(peer.mac?.toUpperCase())||typeof peer.encrypted!=='boolean')errors.push('У каждого устройства должны быть имя, уникальный ID и уникальный unicast MAC.');
  if(peer?.encrypted&&p.encryption){encrypted++;if(!keyValid(peer.lmk))errors.push('У защищенного устройства LMK должен содержать 32 шестнадцатеричных символа.');}
  ids.add(peer?.id);macs.add(typeof peer?.mac==='string'?peer.mac.toUpperCase():null);
 }
 if(encrypted>MAX_ENCRYPTED_PEERS)errors.push('В этом профиле поддерживается до 6 зашифрованных устройств.');
 return [...new Set(errors)];
}
export function espNowLogicIssues(node,project,board=null){
 if(!node.moduleId.startsWith('clex.logic.espnow-'))return [];
 const component=project.components.find(c=>c.id===node.parameters.componentId&&c.moduleId===ESPNOW_MODULE);if(!component)return ['Выберите ESP-NOW из монтажа.'];
 const p=node.parameters,issues=[],peer=readPeers(component).find(peer=>peer.id===p.peerId);
 if(['clex.logic.espnow-send','clex.logic.espnow-command-send'].includes(node.moduleId)&&!peer)issues.push('Выберите удаленное устройство.');
 if(['clex.logic.espnow-command-send','clex.logic.espnow-command-received'].includes(node.moduleId)&&(!p.command?.trim()||new TextEncoder().encode(p.command).length>32))issues.push('Имя команды должно занимать 1-32 байта UTF-8.');
 if(p.message!==undefined&&(p.message.includes('\0')||new TextEncoder().encode(p.message).length>MAX_TEXT_BYTES))issues.push('Сообщение должно занимать не более 160 байт UTF-8 без нулевых символов.');
 if(node.moduleId==='clex.logic.espnow-command-received'&&(!component.parameters.encryption||!readPeers(component).some(peer=>peer.encrypted)))issues.push('Для приема команд добавьте устройство и включите у него «Шифровать соединение».');
 if(node.moduleId==='clex.logic.espnow-mode'&&p.mode==='lr'&&board&&!board.radio?.longRange)issues.push('На выбранной плате нет поддерживаемого Long Range.');
 if(node.moduleId==='clex.logic.espnow-command-send'&&peer&&(!component.parameters.encryption||!peer.encrypted))issues.push('Удаленные команды требуют зашифрованного соединения. Включите «Шифровать соединение» у выбранного устройства.');
 if(node.moduleId==='clex.logic.espnow-mode'&&!component.parameters.allowModeChange)issues.push('Разрешите программное переключение режима в настройках ESP-NOW.');
 return issues;
}

export function espNowAckIssues(node,project,catalog){
 const command=node.moduleId==='clex.logic.espnow-command-received',ack=node.moduleId==='clex.logic.espnow-ack';
 if(!command&&!ack)return [];
 const graph=project.logic,events=graph.edges.filter(edge=>edge.dataType==='event'),seen=new Set(),stack=[node.id],problems=[];
 while(stack.length){const id=stack.pop();if(seen.has(id))continue;seen.add(id);for(const edge of events.filter(e=>command?e.source===id:e.target===id))stack.push(command?edge.target:edge.source);}
 if(command){
  if(graph.nodes.some(n=>n.id!==node.id&&n.moduleId===node.moduleId&&n.parameters.componentId===node.parameters.componentId&&n.parameters.command===node.parameters.command))problems.push('Для одной команды используйте один блок приема.');
  if(!graph.nodes.some(n=>seen.has(n.id)&&n.moduleId==='clex.logic.espnow-ack'&&n.parameters.componentId===node.parameters.componentId))problems.push('Завершите обработку команды блоком «Подтвердить команду ESP-NOW».');
 }else{
  const ancestors=graph.nodes.filter(n=>n.id!==node.id&&seen.has(n.id)),roots=ancestors.filter(n=>n.moduleId==='clex.logic.espnow-command-received'&&n.parameters.componentId===node.parameters.componentId);
  if(!roots.length)problems.push('Подключите подтверждение к цепочке обработки входящей команды этого ESP-NOW.');
  if(ancestors.some(n=>{const m=catalog.modules.find(m=>m.id===n.moduleId);return (m?.firmware.eventSource&&!roots.includes(n))||['clex.logic.espnow-send','clex.logic.espnow-command-send','clex.logic.tone','clex.logic.camera-capture'].includes(n.moduleId);}))problems.push('Подтверждение команды должно завершать ее непосредственную обработку: режим радио, GPIO, счетчик, текст или Serial. Отложенные и независимые события требуют отдельной команды.');
 }
 return problems;
}
