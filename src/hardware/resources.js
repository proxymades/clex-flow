export function hardwareProvider(component, module, board) {
  if (!module?.hardwareInterface) return null;
  return board?.peripherals?.find(provider => provider.id === component.parameters.interfaceId && provider.family === module.hardwareInterface.family && provider.interface === module.hardwareInterface.interface) || null;
}
export function resourceClaims(project, catalog) {
  const board = catalog.boards.find(board => board.id === project.boardId);
  const mounted = project.components.flatMap(component => {
    const module = catalog.modules.find(module => module.id === component.moduleId), provider = hardwareProvider(component,module,board);
    return (provider?.resources || []).map(resource => ({...resource, componentId:component.id,name:component.name}));
  });
  const configured = (board?.peripherals || []).filter(provider=>provider.occupancySetting && project.boardSettings[provider.occupancySetting]==='connected' && !project.components.some(component=>hardwareProvider(component,catalog.modules.find(module=>module.id===component.moduleId),board)?.id===provider.id)).flatMap(provider=>(provider.resources || []).map(resource=>({...resource,componentId:null,name:provider.name})));
  const router=project.components.find(c=>c.moduleId==='clex.hardware.router');
  const wifi=router&&board?.wifi?.driverKey==='hosted'?[{key:'sdmmc:1',label:'ESP-Hosted SDIO',gpios:Object.values(board.wifi.signals),componentId:router.id,name:router.name}]:[];
  const motion=board?.motion?.timerResource&&project.components.find(component=>catalog.modules.find(module=>module.id===component.moduleId)?.stepper);
  const motionTimers=motion?[{key:board.motion.timerResource,label:'Timer1 движения',componentId:motion.id,name:'Шаговые двигатели'}]:[];
  return [...mounted,...configured,...wifi,...motionTimers];
}
const normalized = value => Array.isArray(value) ? value.map(normalized) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])])) : value;
const canonical = value => JSON.stringify(normalized(value));
const shareCompatible = (a,b) => a.share && a.share === b.share && a.configuration && b.configuration && canonical(a.configuration) === canonical(b.configuration);
export function resourceIssues(project, catalog) {
  const claims=resourceClaims(project,catalog),issues=[];
  for (const [index,claim] of claims.entries()) {
    for (const other of claims.slice(index+1)) if ((claim.key===other.key || claim.gpios?.some(gpio=>other.gpios?.includes(gpio))) && !(claim.key===other.key && shareCompatible(claim,other))) issues.push({severity:'error',code:'hardware-resource',componentId:other.componentId,message:`${claim.name} и ${other.name}: ресурс «${claim.label || claim.key}» уже занят. Выберите другой интерфейс или удалите дублирующий компонент.`});
  }
  return issues;
}
export function claimedGpio(project, catalog, gpio) { return resourceClaims(project,catalog).find(claim=>claim.gpios?.includes(gpio)); }
export function sharedPinProblem(project, pin, board) {
  const settings=Array.isArray(pin.sharedWith)?pin.sharedWith:[pin.sharedWith];
  for(const key of settings.filter(Boolean)) {
    if ((project.boardSettings?.[key] || board.options?.[key]?.default) !== 'disconnected') return `Контакт используется интерфейсом «${board.options?.[key]?.label || key}». Укажите отключение в свойствах платы после проверки физического подключения.`;
  }
  return null;
}
