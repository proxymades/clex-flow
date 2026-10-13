// Board-specific label placement remains separate from the physical contact coordinates.
export function boardPinLabel(pin){
 const fontSize=pin.labelFontSize || 10,width=pin.labelWidth || 108,height=22;
 const textX=pin.labelX ?? (pin.side==='left'?pin.x-12:pin.x+12),textY=pin.y+3.5;
 return {text:(pin.displayNumber ?? pin.physicalNumber)+' · '+pin.label,fontSize,textX,textY,textAnchor:pin.side==='left'?'end':'start',x:pin.side==='left'?textX-width+12:textX-12,y:pin.y-11,width,height};
}
