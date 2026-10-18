import {ipv4,networkIssues,probeUrl} from '../network/model.js';

export const ROUTER_MODULE='clex.hardware.router';
export const routerComponent=project=>project.components.find(c=>c.moduleId===ROUTER_MODULE);
export function routerCapabilities(board){
 const wifi=board?.wifi;
 return {available:board?.platform==='esp-idf'&&['native','hosted'].includes(wifi?.driverKey)&&Boolean(wifi?.sta&&wifi?.softap)&&(wifi.driverKey!=='hosted'||Boolean(wifi.profileKey&&wifi.config)),wifi,ethernet:Boolean(board?.networkInterfaces?.some(n=>n.family==='ethernet')),reason:wifi?.limitation||'Для платы нет совместимого Wi-Fi STA/SoftAP-интерфейса.'};
}
export const usesEthernet=p=>p.wanSource==='ethernet'||p.backupWan==='ethernet'||p.lanSource==='ethernet';
export const usesStation=p=>p.wanSource==='wifi'||p.backupWan==='wifi';
export function routerEthernet(project){const p=routerComponent(project)?.parameters;return p&&usesEthernet(p)?project.components.find(c=>c.id===p.ethernetId&&c.moduleId==='clex.hardware.ethernet'):null;}
export function routerPorts(value){try {const rows=JSON.parse(value);return Array.isArray(rows)&&rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r))?rows:null;}catch{return null;}}
const bytes=value=>typeof value==='string'?new TextEncoder().encode(value).length:0;
export function validSubnet(ipText,maskText){
 const ip=ipv4(ipText),mask=ipv4(maskText),host=mask===null?0:(~mask)>>>0;
 return ip!==null&&ip>0&&(ip>>>24)!==127&&(ip>>>24)<224&&mask!==null&&mask!==0&&host>=3&&!(host&(host+1))&&(ip&host)!==0&&((ip&host)>>>0)!==host;
}
export function overlap(ipA,maskA,ipB,maskB){const a=ipv4(ipA),b=ipv4(ipB),ma=ipv4(maskA),mb=ipv4(maskB);return [a,b,ma,mb].every(v=>v!==null)&&((a&ma&mb)>>>0)===((b&ma&mb)>>>0);}
export function routerIssues(component,project,catalog){
 const board=catalog.boards.find(b=>b.id===project.boardId),cap=routerCapabilities(board),p=component.parameters,errors=[];
 if(!cap.available)errors.push(cap.reason);
 for(const key of ['natEnabled','dhcpEnabled','autoStart','hidden','otaEnabled'])if(typeof p[key]!=='boolean')errors.push('Переключатели маршрутизатора должны иметь логическое значение.');
 for(const key of ['leaseMinutes','probeInterval','probeTimeout'])if(!Number.isInteger(p[key]))errors.push('Интервалы и срок аренды DHCP должны быть целыми числами.');
 if(project.components.filter(c=>c.moduleId===ROUTER_MODULE).length>1)errors.push('В проекте поддерживается один маршрутизатор.');
 if(project.components.some(c=>c.moduleId==='clex.hardware.espnow'))errors.push('ESP-NOW и маршрутизатор сейчас требуют исключительного управления одним радио. Удалите один из компонентов.');
 if(!['wifi','ethernet'].includes(p.wanSource)||!['none','wifi','ethernet'].includes(p.backupWan)||!['softap','ethernet'].includes(p.lanSource))errors.push('Выберите поддерживаемые WAN и LAN.');
 if(p.backupWan===p.wanSource)errors.push('Резервный WAN должен отличаться от основного.');
 if(p.lanSource==='ethernet'&&(p.wanSource==='ethernet'||p.backupWan==='ethernet'))errors.push('Один Ethernet-интерфейс не может одновременно быть WAN и LAN.');
 const ethernet=routerEthernet(project);
 if(usesEthernet(p)&&(!cap.ethernet||!ethernet))errors.push('Добавьте и выберите совместимый Ethernet-компонент в монтаже.');
 if(usesStation(p)){
  if(bytes(p.staSsid)<1||bytes(p.staSsid)>32)errors.push('SSID WAN должен содержать 1-32 байта UTF-8.');
  if(p.staPassword!==''&&(bytes(p.staPassword)<8||bytes(p.staPassword)>63))errors.push('Пароль WAN: 8-63 байта либо пустой для открытой сети.');
  const network={parameters:{providerId:'sta',addressMode:p.staAddressMode,staticIp:p.staIp,netmask:p.staMask,gateway:p.staGateway,dns:p.staDns,spiHost:''}};
  errors.push(...networkIssues(network,{networkInterfaces:[{id:'sta',family:'wifi'}]}, {network:{family:'wifi'}}).filter(s=>!s.includes('интерфейса')));
 }
 if(bytes(p.apSsid)<1||bytes(p.apSsid)>32)errors.push('SSID локальной сети должен содержать 1-32 байта UTF-8.');
 if(bytes(p.apPassword)<8||bytes(p.apPassword)>63)errors.push('Пароль локальной Wi-Fi-сети должен содержать 8-63 байта.');
 if(!cap.wifi?.authModes?.includes(p.apAuth))errors.push('Выбранная защита SoftAP не поддерживается Wi-Fi-адаптером.');
 if(!Number.isInteger(p.channel)||p.channel<1||p.channel>11)errors.push('Канал SoftAP должен быть целым числом 1-11.');
 if(!Number.isInteger(p.maxClients)||p.maxClients<1||p.maxClients>(cap.wifi?.maxClients||4))errors.push('Число клиентов превышает возможности Wi-Fi-адаптера.');
 if(!validSubnet(p.lanIp,p.lanMask))errors.push('Укажите корректный LAN-адрес и непрерывную маску с доступными адресами клиентов.');
 const ip=ipv4(p.lanIp),mask=ipv4(p.lanMask),start=ipv4(p.dhcpStart),end=ipv4(p.dhcpEnd);
 if(p.dhcpEnabled===true&&(!validSubnet(p.dhcpStart,p.lanMask)||!validSubnet(p.dhcpEnd,p.lanMask)||start>end||((start&mask)>>>0)!==((ip&mask)>>>0)||((end&mask)>>>0)!==((ip&mask)>>>0)||(ip>=start&&ip<=end)))errors.push('Диапазон DHCP должен находиться в LAN-подсети и не включать шлюз, адрес сети или broadcast.');
 if(p.lanDns&&(!ipv4(p.lanDns)||(ipv4(p.lanDns)>>>24)>=224))errors.push('Укажите корректный DNS для клиентов либо оставьте поле пустым для DNS WAN.');
 if(p.lanDns===p.lanIp)errors.push('Вышестоящий DNS не должен совпадать с LAN-адресом маршрутизатора.');
 const staticWan=[];
 if(usesStation(p)&&p.staAddressMode==='static')staticWan.push([p.staIp,p.staMask]);
 if(ethernet&&p.lanSource!=='ethernet'&&ethernet.parameters.addressMode==='static')staticWan.push([ethernet.parameters.staticIp,ethernet.parameters.netmask]);
 if(staticWan.some(([ip,mask])=>overlap(ip,mask,p.lanIp,p.lanMask)))errors.push('WAN- и LAN-подсети пересекаются. Выберите другую LAN-подсеть.');
 if(bytes(p.adminPassword)<12||bytes(p.adminPassword)>63||!/^[-a-zA-Z0-9_]{1,24}$/.test(p.adminUser))errors.push('Задайте имя администратора (латиница, цифры, _ или -) и пароль 12-63 байта.');
 const url=probeUrl(p.probeUrl);if(!url)errors.push('Для проверки интернета нужен корректный URL HTTP/HTTPS без учетных данных.');
 const ports=routerPorts(p.portMappings);if(!ports||ports.length>16)errors.push('Допускается до 16 правил проброса портов.');
 else {const seen=new Set();for(const r of ports){const host=ipv4(r.host),key=r.protocol+':'+r.externalPort;if(!['tcp','udp'].includes(r.protocol)||!Number.isInteger(r.externalPort)||r.externalPort<1||r.externalPort>65535||!Number.isInteger(r.internalPort)||r.internalPort<1||r.internalPort>65535||!validSubnet(r.host,p.lanMask)||((host&mask)>>>0)!==((ip&mask)>>>0)||host===ip||seen.has(key))errors.push('Правило проброса: уникальный TCP/UDP-порт 1-65535 и адрес клиента в LAN.');seen.add(key);}}
 if(p.otaEnabled&&board?.firmware?.flashSizeMb<8)errors.push('Для двух OTA-разделов требуется не менее 8 МБ Flash.');
 return [...new Set(errors)];
}
