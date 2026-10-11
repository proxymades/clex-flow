export const networkProvider = (component, board, module) => board?.networkInterfaces?.find(provider=>provider.id===component?.parameters.providerId && provider.family===module?.network?.family) || null;
export function spiUsage(project,catalog) {
  const board=catalog.boards.find(board=>board.id===project.boardId);
  return project.components.flatMap(component=>{
    const module=catalog.modules.find(module=>module.id===component.moduleId),provider=networkProvider(component,board,module);
    return module?.display?.interface==='spi'||provider?.interface==='spi' ? [{componentId:component.id,name:component.name,host:Number(component.parameters.spiHost)}] : [];
  }).filter(item=>item.host>0);
}
export function spiOptions(project,catalog,componentId) {
  const board=catalog.boards.find(board=>board.id===project.boardId),usage=spiUsage(project,catalog);
  return (board?.interfaces?.spi?.hosts||[]).map(host=>({value:String(host),label:'SPI'+host,busy:usage.filter(item=>item.host===host&&item.componentId!==componentId).map(item=>item.name)}));
}
export function ipv4(value) {
  if(typeof value!=='string'||!/^\d{1,3}(\.\d{1,3}){3}$/.test(value))return null;
  const parts=value.split('.').map(Number);return parts.every(part=>part<=255)?parts.reduce((result,part)=>(result*256+part)>>>0,0):null;
}
export function networkIssues(component,board,module) {
  const issues=[],provider=networkProvider(component,board,module),p=component.parameters;
  if(!provider)return ['На выбранной плате нет описанного сетевого интерфейса.'];
  if(provider.interface==='spi'&&!board.interfaces?.spi?.hosts.includes(Number(p.spiHost)))issues.push('Выберите доступный SPI для сетевого интерфейса.');
  if(!['dhcp','static'].includes(p.addressMode))issues.push('Выберите DHCP или статический IPv4.');
  if(p.addressMode==='static'){
    const ip=ipv4(p.staticIp),mask=ipv4(p.netmask),gateway=ipv4(p.gateway),dns=p.dns?ipv4(p.dns):0;
    if(ip===null||ip===0||(ip>>>24)===127||(ip>>>24)>=224)issues.push('Укажите корректный IPv4-адрес устройства.');
    if(mask===null||mask===0||mask===0xffffffff||(((~mask)>>>0)&((((~mask)>>>0)+1)>>>0))!==0)issues.push('Укажите непрерывную маску IPv4-подсети.');
    if(gateway===null||gateway===0||ip!==null&&mask!==null&&(ip&mask)!==(gateway&mask))issues.push('Шлюз должен находиться в подсети устройства.');
    if(dns===null)issues.push('Укажите корректный DNS или оставьте поле пустым.');
    if(ip!==null&&mask!==null&&((ip&~mask)===0||(ip&~mask)===(~mask>>>0)))issues.push('Адрес устройства совпадает с адресом сети или broadcast.');
  }
  return issues;
}
export function probeUrl(value) {
  try { const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.hostname&&url.hostname.length<=253&&!url.hostname.startsWith('[')&&!url.username&&!url.password&&!url.hash?url:null; } catch { return null; }
}
