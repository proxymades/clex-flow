import fontUrl from './fonts/Montserrat-Medium.ttf?url';

export default function ScreenPreview({ display, screen, maxWidth = 180, maxHeight = 140, selected, onElementPointerDown }) {
  if (!display) return null;
  const { width, height } = display.resolution;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return <div className="screen-preview" style={{ width: width * scale, height: height * scale }}>
    <style>{'@font-face{font-family:ClexMontserrat;src:url("' + fontUrl + '") format("truetype");font-weight:500;font-style:normal}'}</style>
    <div className="screen-pixels" data-screen-width={width} data-screen-height={height} style={{ width, height, background: screen.background, transform: 'scale(' + scale + ')' }}>
      {screen.elements.map(element => {
        const font = display.graphics.fonts.find(font => font.id === element.fontId);
        return <span key={element.id} data-screen-element={element.id} className={'screen-text ' + (selected === element.id ? 'screen-text-selected' : '')} onPointerDown={event => onElementPointerDown?.(event, element.id, scale)} style={{ left: element.x, top: element.y, fontFamily: font?.family || 'sans-serif', fontSize: font?.size || 14, lineHeight: (font?.lineHeight || font?.size || 14) + 'px', fontWeight: 500, color: element.color }}>{element.text}</span>;
      })}
    </div>
  </div>;
}
