export type HsvColor={h:number;s:number;v:number};
export const unit=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;

/** Hue is measured in degrees; saturation and brightness are in [0, 1]. */
export function hsvToHex(color:HsvColor):string{
  const hue=Number.isFinite(color.h)?((color.h%360)+360)%360:0;
  const saturation=unit(color.s),brightness=unit(color.v);
  const chroma=brightness*saturation;
  const secondary=chroma*(1-Math.abs((hue/60)%2-1));
  const floor=brightness-chroma;
  const channels=hue<60?[chroma,secondary,0]:hue<120?[secondary,chroma,0]:hue<180?[0,chroma,secondary]:hue<240?[0,secondary,chroma]:hue<300?[secondary,0,chroma]:[chroma,0,secondary];
  return '#'+channels.map(channel=>Math.round((channel+floor)*255).toString(16).padStart(2,'0')).join('');
}

export function hexToHsv(hex:string):HsvColor|null{
  let raw=hex.trim().replace(/^#/,'');
  if(/^[\da-f]{3}$/i.test(raw))raw=raw.split('').map(character=>character+character).join('');
  if(!/^[\da-f]{6}$/i.test(raw))return null;
  const [red,green,blue]=[0,2,4].map(index=>parseInt(raw.slice(index,index+2),16)/255);
  const max=Math.max(red,green,blue),min=Math.min(red,green,blue),delta=max-min;
  let hue=0;
  if(delta>0){
    if(max===red)hue=60*(((green-blue)/delta)%6);
    else if(max===green)hue=60*((blue-red)/delta+2);
    else hue=60*((red-green)/delta+4);
  }
  return {h:(hue+360)%360,s:max===0?0:delta/max,v:max};
}
