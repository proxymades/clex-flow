import {useState} from 'react';
import {mqttNetworks} from './model.js';

export default function MqttSettings({component,module,project,catalog,busy,onChange}){
 const p=component.parameters,[showPassword,setShowPassword]=useState(false),networks=mqttNetworks(project,catalog);
 const change=(key,value)=>{
  const parameters={...p,[key]:value};
  if(key==='tls'&&((value&&p.port===1883)||(!value&&p.port===8883)))parameters.port=value?8883:1883;
  if(key==='protocol'&&value==='3.1.1'){parameters.sessionExpiry=0;parameters.lwtDelay=0;}
  onChange(component.id,{parameters});
 };
 const field=key=>{
  const s=module.parameters[key];
  return <label className="field" key={key} title={s.description}>{s.label}{key==='networkId'?<select aria-label={s.label} disabled={busy} value={p[key]} onChange={event=>change(key,event.target.value)}><option value="">Маршрут платы по умолчанию</option>{p[key]&&!networks.some(network=>network.id===p[key])&&<option value={p[key]}>Подключение удалено или несовместимо</option>}{networks.map(network=><option key={network.id} value={network.id}>{network.name}</option>)}</select>:s.type==='select'?<select aria-label={s.label} disabled={busy} value={p[key]} onChange={event=>change(key,event.target.value)}>{s.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:s.type==='boolean'?<select aria-label={s.label} disabled={busy} value={String(p[key])} onChange={event=>change(key,event.target.value==='true')}><option value="true">Включено</option><option value="false">Выключено</option></select>:['caPem','lwtPayload'].includes(key)?<textarea aria-label={s.label} disabled={busy} rows={key==='caPem'?7:4} maxLength={s.maxLength} value={p[key]} spellCheck={false} onChange={event=>change(key,event.target.value)}/>:<input aria-label={s.label} disabled={busy} type={key==='password'&&!showPassword?'password':s.type==='number'?'number':'text'} autoComplete={key==='password'?'new-password':'off'} maxLength={s.maxLength} min={s.min} max={s.max} step={s.step} value={p[key]} onChange={event=>change(key,s.type==='number'?Number(event.target.value):event.target.value)}/>}</label>;
 };
 const group=(title,keys)=><details className="board-sources" open><summary>{title}</summary>{keys.map(field)}</details>;
 return <>
 {group('Подключение',['networkId','host','port','protocol','clientId'])}
 {!networks.length&&<p className="inspector-warning">Добавьте Wi-Fi, маршрутизатор или Ethernet-компонент в монтаж.</p>}
 <p className="panel-note">MQTT использует выбранное сетевое подключение платы. При выборе маршрутизатора соединение следует его активному WAN-подключению. Пустой Client ID заменяется постоянным идентификатором платы и этого MQTT-компонента. Для сохраняемой сессии укажите явный Client ID.</p>
 {group('Аутентификация',['username','password'])}
 <label className="espnow-check"><input type="checkbox" disabled={busy} checked={showPassword} onChange={event=>setShowPassword(event.target.checked)}/> Показать пароль</label>
 {group('Защита TLS',['tls',...(p.tls?['caMode',...(p.caMode==='pem'?['caPem']:[])]:[])])}
 {p.tls&&<p className="panel-note">Сертификат брокера и имя хоста проверяются обязательно. Для собственного CA вставьте корневой сертификат PEM. Для проверки срока действия сертификата нужны достоверные часы устройства.</p>}
 {group('Сессия',['keepAlive','cleanSession',...(p.protocol==='5.0'?['sessionExpiry']:[])])}
 {group('Запуск и восстановление',['autoConnect','autoReconnect','reconnectMs','timeoutMs'])}
 <p className="panel-note">Автоматическое подключение работает без блока «MQTT – Управление». Подписки активных блоков восстанавливаются после возвращения связи. Ручное отключение приостанавливает переподключение до команды «Подключить».</p>
 {group('Последняя воля (LWT)',['lwtEnabled',...(p.lwtEnabled?['lwtTopic','lwtPayload','lwtQos','lwtRetain',...(p.protocol==='5.0'?['lwtDelay']:[])]:[])])}
 <p className="panel-note">Настройки и пароль находятся в локальном файле проекта и прошивке. Каждое MQTT-подключение использует память для сетевой задачи, буферов и очереди сообщений; при нехватке памяти ошибка выводится в диагностике.</p>
 </>;
}
