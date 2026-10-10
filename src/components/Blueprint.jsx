const pinY = index => 88.5 + index * 13;
const wires = [
  { color: '#8b5cf6', x: 45, y: 91, path: `M45 91H104Q120 91 120 107V${pinY(3) - 16}Q120 ${pinY(3)} 136 ${pinY(3)}H155` },
  { color: '#34d399', x: 392, y: 56, path: `M287 ${pinY(1)}H326Q342 ${pinY(1)} 342 ${pinY(1) - 16}V72Q342 56 358 56H392` },
  { color: '#8b5cf6', x: 392, y: 211, path: `M287 ${pinY(5)}H313Q330 ${pinY(5)} 330 ${pinY(5) + 17}V194Q330 211 347 211H392` },
  { color: '#34d399', x: 47, y: 229, path: `M155 ${pinY(7)}H112Q95 ${pinY(7)} 95 ${pinY(7) + 17}V212Q95 229 78 229H47` },
];
export default function Blueprint() {
  return <svg className="blueprint" viewBox="0 0 440 270" fill="none" aria-hidden="true">
    <defs><pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#64748b" opacity=".35" /></pattern><linearGradient id="board" x1="170" y1="40" x2="290" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#27243d" /><stop offset="1" stopColor="#141824" /></linearGradient></defs>
    <rect width="440" height="270" fill="url(#dots)" />
    {wires.map((wire, index) => <g key={index}><path d={wire.path} stroke={wire.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".7" /><circle cx={wire.x} cy={wire.y} r="4" fill={wire.color} /></g>)}
    <rect x="164" y="38" width="114" height="201" rx="15" fill="url(#board)" stroke="#7662ad" strokeWidth="1.2" />
    <path d={`M164 ${pinY(3)}H187M278 ${pinY(1)}H255M278 ${pinY(5)}H255M164 ${pinY(7)}H172Q180 ${pinY(7)} 180 ${pinY(7) - 8}V158Q180 150 187 150`} stroke="#7662ad" strokeWidth="1" opacity=".4" />
    <path d="M183 62h75m-75 8h75m-75 8h75" stroke="#94a3b8" opacity=".35" />
    <rect x="187" y="95" width="68" height="67" rx="7" fill="#10121c" stroke="#8b5cf6" />
    <text x="221" y="123" textAnchor="middle" fill="#c4b5fd" fontSize="10" fontFamily="monospace">CLEX</text><text x="221" y="141" textAnchor="middle" fill="#f1f5f9" fontSize="15" fontFamily="monospace">FLOW</text>
    <rect x="199" y="207" width="44" height="32" rx="5" fill="#0b0d14" stroke="#64748b" /><path d="M209 226h24" stroke="#64748b" strokeWidth="3" />
    <circle cx="249" cy="185" r="3" fill="#34d399" /><rect x="188" y="180" width="13" height="10" rx="2" fill="#4b4665" />
    {Array.from({ length: 9 }, (_, index) => <g key={index}><rect x="155" y={pinY(index) - 2.5} width="9" height="5" rx="1" fill="#817991" /><rect x="278" y={pinY(index) - 2.5} width="9" height="5" rx="1" fill="#817991" /></g>)}
  </svg>;
}
