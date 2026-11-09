/** PWA Liquid Glass masks rendered natively with react-native-svg. */
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,AppState,Easing,StyleSheet,View} from 'react-native';
import Svg,{Defs,Ellipse,FeGaussianBlur,Filter,LinearGradient,Mask,Path,RadialGradient,Rect,Stop} from 'react-native-svg';
import type {Palette,ThemeName} from './theme';
import {mixSceneColor,SCENE_PATHS,wavesFromAccent} from './ConnectNativeScene';

export function glassColor(hex:string,alpha:number):string {
  const raw=hex.startsWith('#')?hex.slice(1):hex;
  if(!/^[0-9a-fA-F]{6}$/.test(raw))return `rgba(24,38,55,${alpha})`;
  return `rgba(${parseInt(raw.slice(0,2),16)},${parseInt(raw.slice(2,4),16)},${parseInt(raw.slice(4,6),16)},${Math.max(0,Math.min(1,alpha))})`;
}

export default function ConnectNativeGlass({colors,theme}:{colors:Palette;theme:ThemeName}) {
  const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const [reducedMotion,setReducedMotion]=useState(true);
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const progress=useRef(new Animated.Value(0)).current;
  const [primary,secondary,tertiary]=useMemo(()=>wavesFromAccent(colors.accent),[colors.accent]);
  // The palette has no explicit mode field; luminance also handles custom callers.
  const light=parseInt(colors.bg.slice(1,3),16)>150;
  useEffect(()=>{
    let alive=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive)setReducedMotion(value);}).catch(()=>{});
    const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',setReducedMotion);
    const state=AppState.addEventListener('change',value=>setForeground(value==='active'));
    return()=>{alive=false;motion.remove();state.remove();};
  },[]);
  useEffect(()=>{
    progress.setValue(0);
    if(theme==='minimal'||reducedMotion||!foreground)return;
    const motion=Animated.loop(Animated.sequence([
      Animated.timing(progress,{toValue:1,duration:28000,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),
      Animated.timing(progress,{toValue:0,duration:28000,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),
    ]));
    motion.start();
    return()=>motion.stop();
  },[progress,theme,reducedMotion,foreground]);
  if(theme==='minimal')return null;
  const wave=theme==='waves';
  const [main,side]=SCENE_PATHS[theme];
  const url=(name:string)=>`url(#${id}-${name})`;
  const name=(suffix:string)=>id+'-'+suffix;
  const shift=progress.interpolate({inputRange:[0,1],outputRange:[-4,6]});
  const scale=progress.interpolate({inputRange:[0,1],outputRange:[1.02,1.05]});
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill,{overflow:'hidden'}]}>
    <Svg width="100%" height="100%" viewBox="0 0 600 1100" preserveAspectRatio="none" opacity={light?(wave?.35:.42):1}>
      <Defs>
        <RadialGradient id={name('left')} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={primary} stopOpacity={wave?.24:.23}/><Stop offset=".88" stopColor={primary} stopOpacity="0"/>
        </RadialGradient>
        <RadialGradient id={name('right')} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={secondary} stopOpacity={wave?.23:.22}/><Stop offset=".89" stopColor={secondary} stopOpacity="0"/>
        </RadialGradient>
        <RadialGradient id={name('top')} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={tertiary} stopOpacity={wave?.08:.11}/><Stop offset=".9" stopColor={tertiary} stopOpacity="0"/>
        </RadialGradient>
      </Defs>
      <Ellipse cx={wave?36:60} cy={wave?869:891} rx={wave?390:420} ry={wave?363:407} fill={url('left')}/>
      <Ellipse cx={wave?546:552} cy={wave?968:957} rx={wave?342:408} ry={wave?341:374} fill={url('right')}/>
      <Ellipse cx={wave?534:450} cy={wave?132:143} rx={wave?384:330} ry={wave?495:506} fill={url('top')}/>
    </Svg>
    <Animated.View style={[StyleSheet.absoluteFill,{opacity:light?(wave?.18:.24):wave?.88:.8,transform:reducedMotion?[]:[{translateX:shift},{scale}]}]}>
      <Svg width="100%" height="100%" viewBox="0 0 600 1100" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <Filter id={name('soft')} x="-70%" y="-200%" width="240%" height="500%"><FeGaussianBlur stdDeviation={wave?34:33}/></Filter>
          <Filter id={name('medium')} x="-70%" y="-200%" width="240%" height="500%"><FeGaussianBlur stdDeviation={wave?13:12}/></Filter>
          <Filter id={name('thin')} x="-70%" y="-200%" width="240%" height="500%"><FeGaussianBlur stdDeviation="3"/></Filter>
          <LinearGradient id={name('fade')} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="white" stopOpacity={wave?.12:.06}/>
            <Stop offset={wave?.27:.32} stopColor="white" stopOpacity={wave?1:.86}/>
            <Stop offset={wave?.75:.74} stopColor="white" stopOpacity={wave?.85:.94}/>
            <Stop offset="1" stopColor="white" stopOpacity={wave?.02:.04}/>
          </LinearGradient>
          <LinearGradient id={name('side-fade')} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="white" stopOpacity=".04"/><Stop offset=".4" stopColor="white" stopOpacity=".75"/>
            <Stop offset=".78" stopColor="white" stopOpacity=".9"/><Stop offset="1" stopColor="white" stopOpacity=".03"/>
          </LinearGradient>
          <LinearGradient id={name('color')} x1="0" y1={wave?.395:.355} x2="1" y2={wave?.605:.645}>
            <Stop offset={wave?.04:0} stopColor={primary}/>
            <Stop offset={wave?.36:.38} stopColor={mixSceneColor(primary,tertiary,wave?.68:.53)}/>
            <Stop offset={wave?.74:.77} stopColor={secondary}/><Stop offset="1" stopColor={tertiary}/>
          </LinearGradient>
          <Mask id={name('mask')} x="-200" y="-200" width="1000" height="1600" maskUnits="userSpaceOnUse">
            <Path d={main} fill="none" stroke={url('fade')} strokeWidth={wave?78:88} strokeLinecap="round" filter={url('soft')} opacity={wave?.64:.68}/>
            <Path d={main} fill="none" stroke={url('fade')} strokeWidth={wave?22:25} strokeLinecap="round" filter={url('medium')} opacity={wave?.64:.67}/>
            <Path d={main} fill="none" stroke={url('fade')} strokeWidth="3" strokeLinecap="round" filter={url('thin')} opacity={wave?.35:.38}/>
            <Path d={side} fill="none" stroke={url(wave?'side-fade':'fade')} strokeWidth={wave?134:126} strokeLinecap="round" filter={url('soft')} opacity={wave?.48:.43}/>
            <Path d={side} fill="none" stroke={url(wave?'side-fade':'fade')} strokeWidth={wave?42:38} strokeLinecap="round" filter={url('medium')} opacity=".4"/>
          </Mask>
        </Defs>
        <Rect width="600" height="1100" fill={url('color')} mask={url('mask')}/>
      </Svg>
    </Animated.View>
  </View>;
}
