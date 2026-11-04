import { ArrowUpRight, Box, Camera, Cpu, Gauge, GitBranch, Globe, Hash, Lightbulb, Mic, Monitor, MousePointerClick, Network, Radio, Repeat2, RotateCw, ScanLine, Terminal, Thermometer, Timer, ToggleRight, Volume2, Wifi } from 'lucide-react';
import MicAudioLines from './MicAudioLines.jsx';

const icons = { ArrowUpRight, Box, Camera, Cpu, Gauge, GitBranch, Globe, Hash, Lightbulb, Mic, MicAudioLines, Monitor, MousePointerClick, Network, Radio, Repeat2, RotateCw, ScanLine, Terminal, Thermometer, Timer, ToggleRight, Volume2, Wifi };

export default function ModuleIcon({ name, ...props }) {
  const Icon = icons[name] || Box;
  return <Icon {...props} />;
}
