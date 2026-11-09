import {useEffect,useMemo,useState} from 'react';
import * as SecureStore from 'expo-secure-store';
import {palettes,themeNames,type Palette,type ThemeName} from './theme';
import {sceneBackground} from './ConnectNativeScene';

export const BUILTIN_PACKS=[
  {id:'speed',name:'Соник',emoji:'⚡'},
  {id:'blocks',name:'Minecraft',emoji:'🧱'},
  {id:'anime-boys',name:'Аниме-парни',emoji:'🧑'},
  {id:'anime-girls',name:'Аниме-девушки',emoji:'👩'},
] as const;
export const ACCENTS=['#087dff','#8055dc','#dc477e','#198f78','#b46b26','#cc4545','#60748b'];
export type DisplayMode='dark'|'light';
export type NativeAppearance={scene:ThemeName;mode:DisplayMode;accent:string;wallpaper:string|null;enabledPacks:string[]};
export const DEFAULT_APPEARANCE:NativeAppearance={scene:'waves',mode:'dark',accent:'#087dff',wallpaper:null,enabledPacks:BUILTIN_PACKS.map(p=>p.id)};
const STORE='connect-native-pwa-appearance-v2';
const LEGACY='connect-native-theme-v1';
const allowedScenes=new Set(themeNames.map(x=>x.id));
const allowedPacks=new Set<string>(BUILTIN_PACKS.map(p=>p.id));
function validAccent(value:unknown):value is string{return typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);}
function normalize(value:unknown):NativeAppearance{
  const d:Partial<NativeAppearance>=typeof value==='object'&&value!==null?value as Partial<NativeAppearance>:{};
  const rawScene=(d as {scene?:string}).scene;
  const scene=rawScene==='glow'?'aurora':rawScene;
  return {
    scene:typeof scene==='string'&&allowedScenes.has(scene as ThemeName)?scene as ThemeName:'waves',
    mode:d.mode==='light'?'light':'dark',
    accent:validAccent(d.accent)?d.accent:DEFAULT_APPEARANCE.accent,
    wallpaper:typeof d.wallpaper==='string'&&d.wallpaper.startsWith('file:')?d.wallpaper:null,
    enabledPacks:Array.isArray(d.enabledPacks)?Array.from(new Set(d.enabledPacks.filter((x):x is string=>typeof x==='string'&&allowedPacks.has(x)))):[...DEFAULT_APPEARANCE.enabledPacks],
  };
}
function paletteFor(p:NativeAppearance):Palette{
  const base=palettes[p.scene];
  if(p.mode==='dark')return {...base,bg:sceneBackground(p.scene,p.accent,false),accent:p.accent};
  return {
    bg:sceneBackground(p.scene,p.accent,true),surface:'#f7fafd',elevated:'#dfeaf5',accent:p.accent,
    text:'#17283b',muted:'#61788f',line:'#b9cad8',danger:'#b9324c',
  };
}
export function useConnectNativeAppearance(){
  const [prefs,setPrefs]=useState<NativeAppearance>(DEFAULT_APPEARANCE);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      try {
        const [stored,old]=await Promise.all([SecureStore.getItemAsync(STORE),SecureStore.getItemAsync(LEGACY)]);
        if(!active)return;
        if(stored)setPrefs(normalize(JSON.parse(stored)));
        else if(old)setPrefs(normalize({scene:old}));
      }catch{/* Invalid device preferences revert to safe defaults. */}
      finally{if(active)setReady(true);}
    })();
    return()=>{active=false};
  },[]);
  useEffect(()=>{
    if(ready)void SecureStore.setItemAsync(STORE,JSON.stringify(prefs)).catch(()=>{});
  },[prefs,ready]);
  const update=(delta:Partial<NativeAppearance>)=>setPrefs(old=>normalize({...old,...delta}));
  const reset=()=>setPrefs({...DEFAULT_APPEARANCE,enabledPacks:[...DEFAULT_APPEARANCE.enabledPacks]});
  const colors=useMemo(()=>paletteFor(prefs),[prefs]);
  return {prefs,colors,ready,update,reset};
}
export type AppearanceController=ReturnType<typeof useConnectNativeAppearance>;
