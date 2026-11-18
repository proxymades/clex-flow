import { isMonochrome, monochromePixel } from './monochrome.js';

export default function ScreenColorField({ display, label, pixelLabel, value, disabled, onChange }) {
  const change = event => onChange(event.target.value);
  if (!isMonochrome(display)) {
    return <label className="field">{label}
      <input aria-label={label} type="color" value={value} disabled={disabled} onChange={change} />
    </label>;
  }
  return <label className="field">{pixelLabel}
    <select aria-label={pixelLabel} value={monochromePixel(value)} disabled={disabled} onChange={change}>
      <option value="#ffffff">Светятся</option>
      <option value="#000000">Выключены</option>
    </select>
  </label>;
}
