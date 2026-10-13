import ScreenImage from './ScreenImage.jsx';
import { indicatorState, indicatorLayout } from './indicator.js';
import { elementPreviewText } from './model.js';
import fontUrl from './fonts/Montserrat-Medium.ttf?url';

export default function ScreenPreview({ display, screen, maxWidth = 180, maxHeight = 140, selected, onElementPointerDown, onElementResizePointerDown, showSplash = false }) {
  if (!display) return null;
  const { width, height } = display.resolution;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return <div className="screen-preview" style={{ width: width * scale, height: height * scale }}>
    <style>{'@font-face{font-family:ClexMontserrat;src:url("' + fontUrl + '") format("truetype");font-weight:500;font-style:normal}'}</style>
    <div className="screen-pixels" data-screen-width={width} data-screen-height={height} style={{ width, height, background: screen.background, transform: 'scale(' + scale + ')' }}>
      {screen.elements.filter(element => showSplash ? element.type === 'image' && element.splash : !(element.type === 'image' && element.splash)).map(element => {
        if (element.type === 'image') return <ScreenImage key={element.id} element={element} scale={scale} selected={selected === element.id} onPointerDown={onElementPointerDown} onResize={onElementResizePointerDown} />;
        const font = display.graphics.fonts.find(font => font.id === element.fontId);
        if (element.type === 'indicator') {
          const state = (selected===element.id&&element.editStateId?element.states.find(state=>state.id===element.editStateId):null)||indicatorState(element), layout = indicatorLayout(element);
          return <div key={element.id} data-screen-element={element.id} className={'screen-indicator ' + (selected === element.id ? 'screen-text-selected' : '')} onPointerDown={event=>onElementPointerDown?.(event,element.id,scale)} style={{left:element.x,top:element.y,width:element.width,height:element.height,borderRadius:element.radius,padding:element.padding,gap:element.gap,flexDirection:layout.direction,background:state.background,color:state.color,fontFamily:font?.family||'sans-serif',fontSize:font?.size||14,lineHeight:(font?.lineHeight||font?.size||14)+'px'}}>
            {element.dotVisible&&<span className="indicator-dot" style={{width:element.dotSize,height:element.dotSize,background:state.dotColor}}/>}
            <span className="indicator-caption" style={{width:Math.max(0,layout.labelWidth),maxHeight:Math.max(0,layout.labelHeight),textAlign:element.align}}>{element.captionDynamic?element.initialCaption:state.text}</span>
            {selected===element.id&&onElementResizePointerDown&&<span role="button" tabIndex={0} aria-label="Изменить размер индикатора" className="indicator-resize" onPointerDown={event=>onElementResizePointerDown(event,element.id,scale)}/>}
          </div>;
        }
        return <span key={element.id} data-screen-element={element.id} className={'screen-text ' + (selected === element.id ? 'screen-text-selected' : '')} onPointerDown={event => onElementPointerDown?.(event, element.id, scale)} style={{ left: element.x, top: element.y, fontFamily: font?.family || 'sans-serif', fontSize: font?.size || 14, lineHeight: (font?.lineHeight || font?.size || 14) + 'px', fontWeight: 500, color: element.color }}>{elementPreviewText(element)}</span>;
      })}
    </div>
  </div>;
}
