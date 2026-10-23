import {networkProvider} from '../network/model.js';
import {routerCapabilities} from '../router/model.js';

export const MQTT_MODULE='clex.hardware.mqtt';
export const MQTT_LOGIC_MODULES=['clex.logic.mqtt-control','clex.logic.mqtt-send','clex.logic.mqtt-receive'];
export const MAX_MQTT_CONNECTIONS=8;
export const MAX_MQTT_FILTERS=16;
export const MAX_MQTT_TOPIC_BYTES=256;
export const MAX_MQTT_PAYLOAD_BYTES=4096;
const bytes=value=>typeof value==='string'?new TextEncoder().encode(value).length:0;
// MQTT strings cannot contain U+0000 or unpaired UTF-16 surrogates.
export const mqttStringValid=value=>typeof value==='string'&&!/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export const mqttComponents=project=>project.components.filter(component=>component.moduleId===MQTT_MODULE);
export function mqttSupported(board){
 return board?.platform==='esp-idf'&&(routerCapabilities(board).available||Boolean(board.networkInterfaces?.some(provider=>provider.family==='ethernet')));
}
export function mqttNetworks(project,catalog){
 const board=catalog.boards.find(board=>board.id===project.boardId);
 return project.components.filter(component=>component.moduleId==='clex.hardware.router'?routerCapabilities(board).available:component.moduleId==='clex.hardware.ethernet'&&Boolean(networkProvider(component,board,catalog.modules.find(module=>module.id===component.moduleId))));
}
export function mqttNetwork(component,project,catalog){
 const networks=mqttNetworks(project,catalog);
 return component.parameters.networkId?networks.find(network=>network.id===component.parameters.networkId)||null:networks.find(network=>network.moduleId==='clex.hardware.router')||networks[0]||null;
}
export function mqttTopicValid(value,{filter=false}={}){
 if(!mqttStringValid(value)||bytes(value)<1||bytes(value)>MAX_MQTT_TOPIC_BYTES)return false;
 if(!filter)return !/[+#]/.test(value);
 let effective=value;
 if(value.startsWith('$share/')){
  const end=value.indexOf('/',7),group=value.slice(7,end);
  if(end<0||!group||/[+#]/.test(group))return false;
  effective=value.slice(end+1);if(!effective)return false;
 }
 const levels=effective.split('/');
 return levels.every((level,index)=>(!level.includes('+')||level==='+')&&(!level.includes('#')||level==='#'&&index===levels.length-1));
}
function jsonRows(value,max){
 if(typeof value!=='string')return null;
 try{const rows=JSON.parse(value);return Array.isArray(rows)&&rows.length<=max&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row))?rows:null;}catch{return null;}
}
export const mqttFilters=value=>jsonRows(value,MAX_MQTT_FILTERS);
export const mqttProperties=value=>jsonRows(value,32);
export function mqttPayloadBytes(value,encoding='utf8'){
 if(typeof value!=='string')return null;
 if(encoding==='utf8')return mqttStringValid(value)?bytes(value):null;
 if(encoding==='hex')return /^(?:[\da-f]{2})*$/i.test(value)?value.length/2:null;
 if(encoding==='base64')return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)?value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0):null;
 return null;
}
function hostValid(value){
 if(typeof value!=='string'||value.length<1||value.length>253)return false;
 if(value.includes(':')){
  if(value.startsWith('[')&&!value.endsWith(']'))return false;
  try{const host=value.startsWith('[')?value:'['+value+']',parsed=new URL('http://'+host);return Boolean(parsed.hostname)&&!parsed.port&&!parsed.username&&!parsed.password&&parsed.pathname==='/';}catch{return false;}
 }
 const name=value.endsWith('.')?value.slice(0,-1):value;
 if(!name||!name.split('.').every(label=>/^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(label)))return false;
 return !/^\d+(?:\.\d+){3}$/.test(name)||name.split('.').every(part=>Number(part)<=255);
}
function hostKey(value){
 if(typeof value!=='string')return '';
 if(value.includes(':')){try{return new URL('http://'+(value.startsWith('[')?value:'['+value+']')).hostname;}catch{return value;}}
 return value.toLowerCase().replace(/\.$/,'');
}
function payloadUtf8(value,encoding){
 const size=mqttPayloadBytes(value,encoding);if(size===null||size>MAX_MQTT_PAYLOAD_BYTES)return false;
 if(encoding==='utf8')return true;
 const data=encoding==='hex'?Uint8Array.from(value.match(/../g)||[],part=>parseInt(part,16)):Uint8Array.from(atob(value),char=>char.charCodeAt(0));
 try{new TextDecoder('utf-8',{fatal:true}).decode(data);return true;}catch{return false;}
}
export function mqttIssues(component,project,catalog){
 const p=component.parameters,errors=[],board=catalog.boards.find(board=>board.id===project.boardId);
 if(!mqttSupported(board))errors.push('Для MQTT нужна плата с поддерживаемым Wi-Fi или Ethernet и ESP-IDF.');
 if(mqttComponents(project).length>MAX_MQTT_CONNECTIONS)errors.push('В проекте допускается до '+MAX_MQTT_CONNECTIONS+' MQTT-подключений.');
 if(!mqttNetwork(component,project,catalog))errors.push('Добавьте и выберите существующий Wi-Fi маршрутизатор или Ethernet-компонент в монтаже.');
 if(!hostValid(p.host))errors.push('Укажите ASCII-имя хоста или IP брокера без схемы, пути и порта.');
 for(const [key,min,max]of[['port',1,65535],['keepAlive',0,65535],['sessionExpiry',0,4294967295],['reconnectMs',1000,300000],['timeoutMs',1000,120000],['lwtDelay',0,4294967295]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)errors.push('Неверное целое значение параметра «'+key+'».');
 for(const key of['tls','cleanSession','autoConnect','autoReconnect','lwtEnabled','lwtRetain'])if(typeof p[key]!=='boolean')errors.push('Неверное логическое значение параметра «'+key+'».');
 if(!['3.1.1','5.0'].includes(p.protocol))errors.push('Выберите MQTT 3.1.1 или MQTT 5.0.');
 for(const [key,max]of[['clientId',128],['username',256],['password',1024]])if(!mqttStringValid(p[key])||bytes(p[key])>max)errors.push('Неверная строка параметра «'+key+'» или превышен размер UTF-8.');
 if((p.cleanSession===false||p.protocol==='5.0'&&p.sessionExpiry>0)&&!p.clientId)errors.push('Для сохраняемой сессии задайте постоянный Client ID.');
 if(p.clientId&&mqttComponents(project).some(other=>other.id!==component.id&&other.parameters.clientId===p.clientId&&hostKey(other.parameters.host)===hostKey(p.host)&&other.parameters.port===p.port))errors.push('Для подключений к одному брокеру нужны разные Client ID.');
 if(p.protocol==='3.1.1'&&(p.sessionExpiry!==0||p.lwtDelay!==0))errors.push('Срок хранения сессии и задержка LWT доступны в MQTT 5.0.');
 if(p.tls){
  if(!['bundle','pem'].includes(p.caMode))errors.push('Выберите источник доверенных сертификатов CA.');
  if(p.caMode==='pem'){
   const matches=typeof p.caPem==='string'?[...p.caPem.matchAll(/-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----/g)]:[];
   const remainder=typeof p.caPem==='string'?p.caPem.replace(/-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/=\s]+?\s*-----END CERTIFICATE-----/g,'').trim():'invalid';
   if(!matches.length||remainder||bytes(p.caPem)>16384||matches.some(match=>(mqttPayloadBytes(match[1].replace(/\s/g,''),'base64')||0)<64))errors.push('Добавьте корневой CA в формате PEM (до 16 КиБ).');
  }
 }
 if(p.lwtEnabled){
  if(!mqttTopicValid(p.lwtTopic))errors.push('Для LWT нужен непустой topic без + и #, до 256 байт UTF-8.');
  if(mqttPayloadBytes(p.lwtPayload)===null||mqttPayloadBytes(p.lwtPayload)>MAX_MQTT_PAYLOAD_BYTES)errors.push('LWT payload должен содержать корректный UTF-8 размером до 4096 байт.');
  if(!['0','1','2'].includes(String(p.lwtQos)))errors.push('Выберите LWT QoS 0, 1 или 2.');
 }
 return [...new Set(errors)];
}
export function mqttLogicIssues(node,project){
 if(!MQTT_LOGIC_MODULES.includes(node.moduleId))return [];
 const p=node.parameters,component=mqttComponents(project).find(component=>component.id===p.componentId),errors=[];
 if(!component)return ['Выберите MQTT-подключение из монтажа.'];
 const mqtt5=component.parameters.protocol==='5.0';
 if(node.moduleId==='clex.logic.mqtt-send'){
  const dynamic=handle=>project.logic.edges.some(edge=>edge.target===node.id&&edge.targetHandle===handle);
  if(!dynamic('topic')&&!mqttTopicValid(p.topic))errors.push('Укажите topic без + и #, до 256 байт UTF-8, либо подключите вход Topic.');
  const size=mqttPayloadBytes(p.payload,p.payloadEncoding);
  if(!dynamic('payload')&&(size===null||size>MAX_MQTT_PAYLOAD_BYTES))errors.push('Payload должен соответствовать кодировке и содержать до 4096 байт после декодирования.');
  if(!['0','1','2'].includes(String(p.qos)))errors.push('Выберите QoS 0, 1 или 2.');
  if(typeof p.retain!=='boolean')errors.push('Retain должен быть логическим значением.');
  if(!['utf8','base64','hex'].includes(p.payloadEncoding))errors.push('Выберите кодировку payload.');
  if(!mqttStringValid(p.contentType)||bytes(p.contentType)>256)errors.push('Content Type: строка UTF-8 до 256 байт.');
  if(p.responseTopic&&!mqttTopicValid(p.responseTopic))errors.push('Response Topic должен быть topic без + и #.');
  const correlation=mqttPayloadBytes(p.correlationData,'base64');
  if(correlation===null||correlation>256)errors.push('Correlation Data: Base64, до 256 байт после декодирования.');
  if(!Number.isInteger(p.messageExpiry)||p.messageExpiry< -1||p.messageExpiry>4294967295)errors.push('Срок сообщения: -1 (без ограничения) или 0-4294967295 секунд.');
  if(!['unspecified','0','1'].includes(p.payloadFormatIndicator))errors.push('Выберите Payload Format Indicator.');
  if(p.payloadFormatIndicator==='1'&&!dynamic('payload')&&!payloadUtf8(p.payload,p.payloadEncoding))errors.push('Payload Format Indicator 1 требует корректного UTF-8 после декодирования payload.');
  const properties=mqttProperties(p.userProperties);
  if(!properties||properties.length>32||properties.some(row=>!mqttStringValid(row.key)||!mqttStringValid(row.value)||bytes(row.key)>128||bytes(row.value)>512)||bytes(p.userProperties)>4096)errors.push('User Properties: до 32 пар UTF-8, ключ до 128 байт, значение до 512 байт, всего до 4096 байт JSON.');
  if(!mqtt5&&(p.contentType||p.responseTopic||p.correlationData||properties?.length||p.messageExpiry!==-1||p.payloadFormatIndicator!=='unspecified'))errors.push('Свойства сообщения доступны в MQTT 5.0.');
 }
 if(node.moduleId==='clex.logic.mqtt-receive'){
  const filters=mqttFilters(p.filters);
  if(!filters||filters.length<1||filters.length>MAX_MQTT_FILTERS)errors.push('Добавьте 1-16 подписок.');
  else if(filters.some(row=>!mqttTopicValid(row.topic,{filter:true})||!['0','1','2'].includes(String(row.qos)))||new Set(filters.map(row=>row.topic)).size!==filters.length)errors.push('Подписки: уникальные topic-фильтры до 256 байт и QoS 0, 1 или 2. «+» занимает уровень, «#» – последний уровень.');
  if(typeof p.autoSubscribe!=='boolean'||typeof p.noLocal!=='boolean'||typeof p.retainAsPublished!=='boolean')errors.push('Неверный переключатель подписки.');
  if(!['utf8','base64','hex'].includes(p.payloadEncoding))errors.push('Выберите кодировку payload.');
  if(!['0','1','2'].includes(p.retainHandling))errors.push('Выберите режим получения Retain-сообщений.');
  if(!mqtt5&&(p.noLocal||p.retainAsPublished||p.retainHandling!=='0'))errors.push('Дополнительные параметры подписок доступны в MQTT 5.0.');
  if(p.noLocal&&filters?.some(row=>typeof row.topic==='string'&&row.topic.startsWith('$share/')))errors.push('No Local нельзя использовать с общей подпиской $share.');
  const conflicting=project.logic.nodes.filter(other=>other.id!==node.id&&other.moduleId===node.moduleId&&other.parameters.componentId===p.componentId).some(other=>mqttFilters(other.parameters.filters)?.some(row=>filters?.some(filter=>filter.topic===row.topic))&&['noLocal','retainAsPublished','retainHandling'].some(key=>other.parameters[key]!==p[key]));
  if(conflicting)errors.push('Блоки с одинаковым topic-фильтром должны использовать одинаковые параметры подписки MQTT 5.0.');
 }
 return [...new Set(errors)];
}
