import { useEffect, useMemo, useRef } from 'react';
import { renderedImage } from './image.js';

export default function ScreenImage({ element, scale, selected, onPointerDown, onResize }) {
  const canvas = useRef(null);
  const pixels = useMemo(() => renderedImage({ image: element.image, width: element.width, height: element.height }).rgba, [element.image, element.width, element.height]);
  useEffect(() => {
    canvas.current.getContext('2d').putImageData(new ImageData(pixels, element.width, element.height), 0, 0);
  }, [pixels, element.width, element.height]);
  return <div data-screen-element={element.id} data-screen-image={element.id} className={'screen-image ' + (selected ? 'screen-text-selected' : '')} style={{ left: element.x, top: element.y, width: element.width, height: element.height }} onPointerDown={event => onPointerDown?.(event, element.id, scale)}>
    <canvas ref={canvas} width={element.width} height={element.height} aria-label={element.name || 'Изображение'} />
    {selected && onResize && <span role="button" tabIndex={0} aria-label="Изменить размер изображения" className="indicator-resize" onPointerDown={event => onResize(event, element.id, scale)} />}
  </div>;
}
