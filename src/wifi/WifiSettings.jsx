import {useState} from 'react';

export default function WifiSettings({component,module,busy,onChange}){
 const [showPassword,setShowPassword]=useState(false),p=component.parameters;
 const change=(key,value)=>onChange(component.id,{parameters:{...p,[key]:value}});
 const field=key=>{
  const parameter=module.parameters[key];
  return <label className="field" key={key} title={parameter.description}>{parameter.label}{parameter.type==='select'?<select aria-label={parameter.label} disabled={busy} value={p[key]} onChange={e=>change(key,e.target.value)}>{parameter.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:parameter.type==='boolean'?<select aria-label={parameter.label} disabled={busy} value={String(p[key])} onChange={e=>change(key,e.target.value==='true')}><option value="true">Включено</option><option value="false">Выключено</option></select>:<input aria-label={parameter.label} disabled={busy} type={key==='password'&&!showPassword?'password':parameter.type==='number'?'number':'text'} autoComplete={key==='password'?'new-password':'off'} maxLength={parameter.maxLength} min={parameter.min} max={parameter.max} step={parameter.step} value={p[key]} onChange={e=>change(key,parameter.type==='number'?Number(e.target.value):e.target.value)}/>}</label>;
 };
 const group=(title,keys)=><details className="board-sources" open><summary>{title}</summary>{keys.map(field)}</details>;
 return <>
 {group('Сеть Wi-Fi',['ssid','password'])}
 <label className="espnow-check"><input type="checkbox" disabled={busy} checked={showPassword} onChange={e=>setShowPassword(e.target.checked)}/> Показать пароль</label>
 {group('Адреса IPv4',['addressMode',...(p.addressMode==='static'?['staticIp','netmask','gateway','dns']:[])])}
 {group('Подключение',['autoConnect','autoReconnect',...(p.autoReconnect?['reconnectMs']:[]),'connectTimeoutMs'])}
 <p className="panel-note">Плата подключается к существующей сети в режиме Station. Это подключение доступно для MQTT и проверки HTTP/HTTPS. Блок «Wi-Fi» в логике позволяет управлять соединением и получать состояние, IP-адрес и причины ошибок.</p>
 <p className="panel-note">Название сети и пароль входят в файл проекта и прошивку. Для раздачи с iPhone оставьте Wi-Fi включенным и включите «Максимальная совместимость» в настройках режима модема.</p>
 </>;
}
