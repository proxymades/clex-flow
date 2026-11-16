export default function Resistor({size=24,color='currentColor',strokeWidth=2,...props}){
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M2 12h4m12 0h4"/><rect x="6" y="8" width="12" height="8" rx="1"/></svg>;
}
