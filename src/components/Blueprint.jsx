import {useEffect,useRef} from 'react';

const pinY = index => 88.5 + index * 13;
const wires = [
  { color: 'var(--ui-lime)', x: 45, y: 91, path: `M45 91H104Q120 91 120 107V${pinY(3) - 16}Q120 ${pinY(3)} 136 ${pinY(3)}H155` },
  { color: 'var(--ui-lime)', x: 392, y: 56, fromBoard: true, path: `M287 ${pinY(1)}H326Q342 ${pinY(1)} 342 ${pinY(1) - 16}V72Q342 56 358 56H392` },
  { color: 'var(--ui-lime)', x: 392, y: 211, fromBoard: true, path: `M287 ${pinY(5)}H313Q330 ${pinY(5)} 330 ${pinY(5) + 17}V194Q330 211 347 211H392` },
  { color: 'var(--ui-lime)', x: 47, y: 229, fromBoard: true, path: `M155 ${pinY(7)}H112Q95 ${pinY(7)} 95 ${pinY(7) + 17}V212Q95 229 78 229H47` },
];
const signalTravel = 2.4;
export default function Blueprint() {
  const signals=useRef([]);
  useEffect(()=>{
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const timers=[];
    const stop=()=>timers.forEach(timer=>window.clearTimeout(timer));
    function schedule(index,delay){
      timers[index]=window.setTimeout(()=>{
        signals.current[index]?.querySelectorAll('animateMotion,animate').forEach(animation=>animation.beginElement());
        schedule(index,(signalTravel+.3+Math.random()*2.4)*1000);
      },delay);
    }
    function start(){
      stop();
      if(!reducedMotion.matches)wires.forEach((_,index)=>schedule(index,100+Math.random()*1500));
    }
    start();
    reducedMotion.addEventListener('change',start);
    return ()=>{stop();reducedMotion.removeEventListener('change',start);};
  },[]);
  return <svg className="blueprint" viewBox="0 0 440 270" fill="none" aria-hidden="true">
    <defs><pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#8c9299" opacity=".25" /></pattern><linearGradient id="board" x1="170" y1="40" x2="290" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#373b40" /><stop offset="1" stopColor="#202327" /></linearGradient></defs>
    <rect width="440" height="270" fill="url(#dots)" />
    {wires.map((wire, index) => <g key={index}>
      <path d={wire.path} stroke="#a8afb5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
      <circle cx={wire.x} cy={wire.y} r="4" fill={wire.color} />
      <circle ref={element=>{signals.current[index]=element;}} className="blueprint-signal" r="2.7" fill="#343b41" opacity="0" pointerEvents="none">
        <animateMotion path={wire.path} keyPoints={wire.fromBoard ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" dur={signalTravel+'s'} begin="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.92;1" calcMode="discrete" dur={signalTravel+'s'} begin="indefinite" />
      </circle>
    </g>)}
    <rect x="164" y="38" width="114" height="201" rx="15" fill="url(#board)" stroke="#858c93" strokeWidth="1.2" />
    <rect x="187" y="95" width="68" height="67" rx="7" fill="#1a1d20" stroke="#92999f" />
    <text x="221" y="123" textAnchor="middle" fill="#bbc2c7" fontSize="10" fontFamily="monospace">CLEX</text><text x="221" y="141" textAnchor="middle" fill="#f5f6f7" fontSize="15" fontFamily="monospace">FLOW</text>
    <rect x="199" y="207" width="44" height="32" rx="5" fill="#16191c" stroke="#858c93" /><path d="M209 226h24" stroke="#858c93" strokeWidth="3" />
    <circle cx="249" cy="185" r="3" fill="var(--ui-lime)" /><rect x="188" y="180" width="13" height="10" rx="2" fill="#697178" />
    {Array.from({ length: 9 }, (_, index) => <g key={index}><rect x="155" y={pinY(index) - 2.5} width="9" height="5" rx="1" fill="#989fa5" /><rect x="278" y={pinY(index) - 2.5} width="9" height="5" rx="1" fill="#989fa5" /></g>)}
  </svg>;
}
