import { ArrowUpRight, Box, Camera, Cpu, EthernetPort, Gauge, GitBranch, GitMerge, Globe, Hash, Lightbulb, Mic, Monitor, MousePointerClick, Network, Radio, Repeat2, RotateCw, Router, ScanLine, Terminal, Thermometer, Timer, ToggleRight, Volume2, Wifi } from 'lucide-react';
import GraphStar from './GraphStar.jsx';
import LayoutArrowRight from './LayoutArrowRight.jsx';
import MicAudioLines from './MicAudioLines.jsx';

const icons = { ArrowUpRight, Box, Camera, Cpu, EthernetPort, Gauge, GitBranch, GitMerge, Globe, GraphStar, Hash, LayoutArrowRight, Lightbulb, Mic, MicAudioLines, Monitor, MousePointerClick, Network, Radio, Repeat2, RotateCw, Router, ScanLine, Terminal, Thermometer, Timer, ToggleRight, Volume2, Wifi };

export default function ModuleIcon({ name, ...props }) {
  const Icon = icons[name] || Box;
  return <Icon {...props} />;
}
