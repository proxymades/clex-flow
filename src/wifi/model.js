import {ipv4Issues} from '../network/model.js';

export const WIFI_MODULE='clex.hardware.wifi';
export const WIFI_LOGIC='clex.logic.wifi';
export const wifiComponent=project=>project.components.find(component=>component.moduleId===WIFI_MODULE);
export function wifiSupported(board){
 const wifi=board?.wifi;
 return board?.platform==='esp-idf'&&Boolean(wifi?.sta)&&(wifi.driverKey==='native'||wifi.driverKey==='hosted'&&Boolean(wifi.profileKey&&wifi.config));
}
const validText=value=>typeof value==='string'&&!/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const bytes=value=>new TextEncoder().encode(value).length;
export function wifiIssues(component,project,catalog){
 const board=catalog.boards.find(board=>board.id===project.boardId),p=component.parameters,issues=[];
 if(!wifiSupported(board))issues.push('У платы нет поддерживаемого Wi-Fi Station-интерфейса.');
 if(project.components.filter(c=>c.moduleId===WIFI_MODULE).length>1)issues.push('Плата поддерживает одно Wi-Fi-подключение.');
 if(project.components.some(c=>c.moduleId==='clex.hardware.router'||c.moduleId==='clex.hardware.espnow'))issues.push('Wi-Fi, маршрутизатор и ESP-NOW используют одно радио. Оставьте один компонент управления радио.');
 if(!validText(p.ssid)||bytes(p.ssid)<1||bytes(p.ssid)>32)issues.push('SSID должен занимать 1-32 байта UTF-8 без нулевых символов.');
 if(!validText(p.password)||p.password!==''&&(bytes(p.password)<8||bytes(p.password)>63))issues.push('Пароль Wi-Fi должен занимать 8-63 байта UTF-8; для открытой сети оставьте поле пустым.');
 for(const key of ['autoConnect','autoReconnect'])if(typeof p[key]!=='boolean')issues.push('Неверный переключатель «'+key+'».');
 for(const [key,min,max]of [['reconnectMs',1000,300000],['connectTimeoutMs',3000,120000]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)issues.push('Неверное время подключения или повторной попытки Wi-Fi.');
 issues.push(...ipv4Issues(p));
 return [...new Set(issues)];
}
