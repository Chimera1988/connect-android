import type {ThemeName} from './theme';

export type SceneColors=readonly [primary:string,secondary:string,tertiary:string];

// Same swatches as Connect PWA components/ConnectDynamicTheme.tsx.
const PRESET_WAVES:Readonly<Record<string,SceneColors>>={
  '#087dff':['#17b8f8','#6b92ff','#94d9ff'],
  '#8055dc':['#a17afb','#7e9cf6','#d48df5'],
  '#dc477e':['#fa66ad','#b97af2','#ff9bba'],
  '#198f78':['#0ad9b7','#65acf4','#79f0d0'],
  '#b46b26':['#f4a951','#efbf7c','#fa8568'],
  '#cc4545':['#f26a72','#d865a7','#ffa293'],
  '#60748b':['#9db9ce','#7199c6','#b8cadc'],
};

function hexRgb(value:string):readonly [number,number,number]|null{
  const hex=value.trim().toLowerCase();
  const short=/^#([0-9a-f]{3})$/.exec(hex);
  if(short)return [0,1,2].map(i=>parseInt(short[1][i].repeat(2),16)) as [number,number,number];
  if(!/^#[0-9a-f]{6}$/.test(hex))return null;
  return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)) as [number,number,number];
}

function hslHex(hue:number,saturation:number,lightness:number):string{
  // Round HSL inputs exactly as the PWA before conversion to native hex colors.
  const h=Math.round((hue+360)%360)/360,s=Math.round(saturation)/100,l=lightness/100;
  const a=s*Math.min(l,1-l);
  const channel=(n:number)=>{
    const k=(n+h*12)%12;
    return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');
  };
  return '#'+channel(0)+channel(8)+channel(4);
}

export function wavesFromAccent(accent:string):SceneColors{
  const normalized=accent.trim().toLowerCase();
  if(PRESET_WAVES[normalized])return PRESET_WAVES[normalized];
  const rgb=hexRgb(normalized);
  if(!rgb)return PRESET_WAVES['#087dff'];
  const [r,g,b]=rgb.map(channel=>channel/255);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,lightness=(max+min)/2;
  let hue=0;
  if(delta>0){
    if(max===r)hue=((g-b)/delta)%6;
    else if(max===g)hue=(b-r)/delta+2;
    else hue=(r-g)/delta+4;
  }
  hue=(hue*60+360)%360;
  const saturation=delta===0?0:delta/(1-Math.abs(2*lightness-1))*100;
  const sat=Math.min(87,Math.max(58,saturation));
  return [hslHex(hue,sat,57),hslHex(hue+24,sat*.86,68),hslHex(hue-18,sat*.74,69)];
}

export function mixSceneColor(first:string,second:string,fraction:number):string{
  const a=hexRgb(first)!,b=hexRgb(second)!;
  return '#'+a.map((channel,i)=>Math.round(channel*fraction+b[i]*(1-fraction)).toString(16).padStart(2,'0')).join('');
}

/** Matches the final palette-responsive CSS rules, including the minimal scene. */
export function sceneBackground(scene:ThemeName,accent:string,light:boolean):string{
  const primary=wavesFromAccent(accent)[0];
  if(scene==='minimal')return mixSceneColor(primary,light?'#f3f6fa':'#0e141e',light?.03:.02);
  if(scene==='waves')return light?'#edf3fa':'#070c15';
  return mixSceneColor(primary,light?'#f3f7fc':'#08111c',light?.06:.04);
}

/** Geometry copied from public/connect-wave-mask.svg and connect-scenes/*.svg. */
export const SCENE_PATHS:Record<Exclude<ThemeName,'minimal'>,readonly [string,string]>={
  waves:['M -125 885 C 60 960, 120 919, 245 827 S 397 650, 630 620','M 155 1240 C 300 1090, 401 1050, 489 936 S 579 826, 735 790'],
  aurora:['M -130 930 C 35 815, 76 890, 190 747 S 390 600, 650 465','M -90 1220 C 110 1040, 270 1130, 385 965 S 535 810, 745 700'],
  moon:['M -140 710 C 40 610, 115 770, 255 670 S 435 490, 680 500','M -130 1130 C 140 1040, 160 1160, 340 950 S 555 790, 750 850'],
  sunset:['M -110 805 C 60 920, 150 960, 282 820 S 510 630, 665 760','M -120 1130 C 120 960, 210 1010, 356 940 S 560 835, 730 920'],
  lagoon:['M -160 1000 C 35 850, 195 990, 305 790 S 450 590, 680 600','M -140 1200 C 100 1160, 170 990, 370 970 S 510 830, 740 750'],
  nebula:['M -180 740 C 35 550, 155 680, 250 840 S 435 1000, 690 775','M -155 1220 C 25 1090, 215 1150, 345 1020 S 530 845, 740 900'],
};
