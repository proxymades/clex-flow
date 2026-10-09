export default function Blueprint() {
  return <svg className="blueprint" viewBox="0 0 440 270" fill="none" aria-hidden="true">
    <defs><pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#64748b" opacity=".35" /></pattern><linearGradient id="board" x1="170" y1="40" x2="290" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#27243d" /><stop offset="1" stopColor="#141824" /></linearGradient></defs>
    <rect width="440" height="270" fill="url(#dots)" />
    <path d="M45 91H104Q120 91 120 107V124H165M275 155H313Q330 155 330 171V211H392M278 103H326Q342 103 342 87V56H392M165 183H112Q95 183 95 199V229H47" stroke="#8b5cf6" strokeWidth="1.5" opacity=".7" />
    <circle cx="45" cy="91" r="4" fill="#8b5cf6" /><circle cx="392" cy="56" r="4" fill="#34d399" /><circle cx="392" cy="211" r="4" fill="#8b5cf6" /><circle cx="47" cy="229" r="4" fill="#34d399" />
    <rect x="164" y="38" width="114" height="201" rx="15" fill="url(#board)" stroke="#7662ad" strokeWidth="1.2" />
    <path d="M183 62h75m-75 8h75m-75 8h75" stroke="#94a3b8" opacity=".35" />
    <rect x="187" y="95" width="68" height="67" rx="7" fill="#10121c" stroke="#8b5cf6" />
    <text x="221" y="123" textAnchor="middle" fill="#c4b5fd" fontSize="10" fontFamily="monospace">ESP32</text><text x="221" y="141" textAnchor="middle" fill="#f1f5f9" fontSize="15" fontFamily="monospace">S3</text>
    <rect x="199" y="207" width="44" height="32" rx="5" fill="#0b0d14" stroke="#64748b" /><path d="M209 226h24" stroke="#64748b" strokeWidth="3" />
    <circle cx="249" cy="185" r="3" fill="#34d399" /><rect x="188" y="180" width="13" height="10" rx="2" fill="#4b4665" />
    {[0,1,2,3,4,5,6,7,8].map(i => <g key={i}><rect x="155" y={86 + i * 13} width="9" height="5" rx="1" fill="#817991" /><rect x="278" y={86 + i * 13} width="9" height="5" rx="1" fill="#817991" /></g>)}
    <text x="27" y="66" fill="#94a3b8" fontSize="9" fontFamily="monospace">IDEA → PROJECT</text><text x="307" y="241" fill="#94a3b8" fontSize="9" fontFamily="monospace">CLEX LAB / 01</text>
  </svg>;
}
