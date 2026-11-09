import React,{createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,Platform,StyleSheet,View,type ViewProps} from 'react-native';
import {BlurTargetView,BlurView} from 'expo-blur';
import type {Palette} from './theme';
import {glassColor} from './ConnectNativeGlass';

type GlassContext={
  target:React.RefObject<React.ComponentRef<typeof View>|null>;
  ready:boolean;
  enabled:boolean;
  reducedTransparency:boolean;
};
const Context=createContext<GlassContext|null>(null);

type GlassProviderProps={
  /** The scene behind foreground UI. Keep BlurViews outside this target. */
  backdrop:React.ReactNode;
  children:React.ReactNode;
  /** Pass false for the minimal scene. */
  enabled?:boolean;
  style?:ViewProps['style'];
};

/**
 * Expo SDK 58 requires a real BlurTargetView ref on Android. Foreground panels
 * are siblings of the target so capturing the scene cannot capture the blur
 * itself. Mount each BlurView only after the target's first native layout.
 *
 * <ConnectNativeGlassProvider backdrop={<ConnectNativeGlass .../>}>
 *   <View style={{flex:1}}>{content}</View>
 *   <ConnectNativeGlassPanel colors={colors} style={dockStyle}>...</ConnectNativeGlassPanel>
 * </ConnectNativeGlassProvider>
 */
export function ConnectNativeGlassProvider({backdrop,children,enabled=true,style}:GlassProviderProps){
  const target=useRef<React.ComponentRef<typeof View>|null>(null);
  const [ready,setReady]=useState(false);
  const [reducedTransparency,setReducedTransparency]=useState(false);
  useEffect(()=>{
    let alive=true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value=>{if(alive)setReducedTransparency(value);}).catch(()=>{});
    const sub=AccessibilityInfo.addEventListener('reduceTransparencyChanged',setReducedTransparency);
    return()=>{alive=false;sub.remove();};
  },[]);
  const context=useMemo(()=>({target,ready,enabled,reducedTransparency}),[ready,enabled,reducedTransparency]);
  const backgroundColor=StyleSheet.flatten(style)?.backgroundColor;
  return <Context.Provider value={context}>
    <View style={[{flex:1},style]}>
      <BlurTargetView ref={target} collapsable={false} pointerEvents="none" accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" onLayout={()=>setReady(true)} style={[StyleSheet.absoluteFill,{backgroundColor}]}>
        {backdrop}
      </BlurTargetView>
      {children}
    </View>
  </Context.Provider>;
}

type GlassPanelProps=ViewProps&{
  colors:Palette;
  /** Native blur intensity. Android divides this by blurReductionFactor=2. */
  intensity?:number;
  /** Optional extra tint for foreground text contrast. */
  overlayOpacity?:number;
};

/**
 * A View replacement preserving flex direction, padding and all children.
 * style.backgroundColor is replaced by the glass tint, otherwise an opaque
 * caller style would obscure the backdrop blur. Border/radius remain intact.
 * Android API <31 uses the SDK's translucent fallback to avoid software blur
 * on every animated frame. Without a provider, render a normal tinted panel.
 */
export default function ConnectNativeGlassPanel({colors,intensity=52,overlayOpacity,style,children,...props}:GlassPanelProps){
  const context=useContext(Context);
  const light=parseInt(colors.bg.slice(1,3),16)>150;
  const solid=Boolean(context&&(!context.enabled||context.reducedTransparency));
  const canBlur=Boolean(context?.ready&&context.enabled&&!context.reducedTransparency);
  const alpha=overlayOpacity??(light?.55:.48);
  return <View {...props} style={[style,{backgroundColor:solid?colors.surface:'transparent',overflow:'hidden'}]}>
    {canBlur&&<BlurView pointerEvents="none" accessible={false} accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}
      blurTarget={context!.target} blurMethod={Platform.OS==='android'?'dimezisBlurViewSdk31Plus':'none'}
      tint={light?'light':'dark'} intensity={Math.max(1,Math.min(100,intensity))} blurReductionFactor={2}/>}
    {!solid&&<View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:glassColor(colors.surface,canBlur?alpha:.85)}]}/>}
    {children}
  </View>;
}
