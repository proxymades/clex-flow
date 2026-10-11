export function choosePort(ports, selected) {
  if (ports.some(port => port.path === selected)) return selected;
  const usb = ports.filter(port => port.usb);
  if (usb.length === 1) return usb[0].path;
  return ports.length === 1 ? ports[0].path : '';
}
