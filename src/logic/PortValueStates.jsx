import {valueStates} from './valueStates.js';
export default function PortValueStates({port}){
 const descriptor=valueStates(port);if(!descriptor)return null;
 return <ul className="port-value-states" aria-label="Значения состояния">{descriptor.options.map(option=><li key={JSON.stringify(option.value)}><i style={{background:option.dotColor}}/><span>{String(option.value)} – {option.label}</span></li>)}</ul>;
}
