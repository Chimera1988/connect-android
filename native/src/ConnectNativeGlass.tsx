/** Connect Native visual foundation – native interpretation of the Connect PWA Liquid Glass scene.
 * Uses existing react-native-svg and the current theme palette. No WebView.
 */
import React,{useEffect,useRef} from 'react';
import {Animated,StyleSheet,View} from 'react-native';
import Svg,{Defs,Ellipse,LinearGradient,Path,RadialGradient,Stop} from 'react-native-svg';
import type {Palette,ThemeName} from './theme';

export function glassColor(hex:string,alpha:number):string {
  const raw=hex.startsWith('#')?hex.slice(1):hex;
  if(!/^[0-9a-fA-F]{6}$/.test(raw))return `rgba(24,38,55,${alpha})`;
  return `rgba(${parseInt(raw.slice(0,2),16)},${parseInt(raw.slice(2,4),16)},${parseInt(raw.slice(4,6),16)},${alpha})`;
}

export default function ConnectNativeGlass({colors,theme}:{colors:Palette;theme:ThemeName}) {
  const progress=useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    const motion=Animated.loop(Animated.sequence([
      Animated.timing(progress,{toValue:1,duration:11000,useNativeDriver:true}),
      Animated.timing(progress,{toValue:0,duration:11000,useNativeDriver:true}),
    ]));
    if(theme!=='minimal')motion.start();
    return()=>motion.stop();
  },[progress,theme]);
  if(theme==='minimal')return null;
  const shift=progress.interpolate({inputRange:[0,1],outputRange:[-15,14]});
  return <View pointerEvents="none" style={[({position:"absolute" as const,top:0,right:0,bottom:0,left:0}),{overflow:'hidden'}]}>
    <Svg width="100%" height="100%" viewBox="0 0 390 820" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id="topGlow" cx="90%" cy="12%" rx="70%" ry="35%">
          <Stop offset="0" stopColor={colors.accent} stopOpacity="0.15"/>
          <Stop offset="1" stopColor={colors.accent} stopOpacity="0"/>
        </RadialGradient>
        <RadialGradient id="bottomGlow" cx="8%" cy="78%" rx="96%" ry="62%">
          <Stop offset="0" stopColor={colors.accent} stopOpacity="0.28"/>
          <Stop offset="1" stopColor={colors.accent} stopOpacity="0"/>
        </RadialGradient>
      </Defs>
      <Ellipse cx="340" cy="108" rx="250" ry="220" fill="url(#topGlow)"/>
      <Ellipse cx="44" cy="705" rx="320" ry="350" fill="url(#bottomGlow)"/>
    </Svg>
    <Animated.View pointerEvents="none" style={{position:'absolute',left:-28,right:-28,bottom:-9,height:'70%',transform:[{translateX:shift}]}}>
      <Svg width="100%" height="100%" viewBox="0 0 450 620" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="waveA" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.accent} stopOpacity="0.33"/>
            <Stop offset="0.46" stopColor="#4879b6" stopOpacity="0.17"/>
            <Stop offset="1" stopColor={colors.accent} stopOpacity="0"/>
          </LinearGradient>
          <LinearGradient id="waveB" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#568fd5" stopOpacity="0"/>
            <Stop offset="0.52" stopColor="#568fd5" stopOpacity="0.25"/>
            <Stop offset="1" stopColor={colors.accent} stopOpacity="0.20"/>
          </LinearGradient>
        </Defs>
        <Path d="M-25 440 C110 275 196 602 477 340 L477 630 L-25 630 Z" fill="url(#waveA)"/>
        <Path d="M-20 512 C115 355 267 539 475 386 L475 625 L-20 625 Z" fill="url(#waveB)"/>
        <Path d="M-22 463 C150 307 270 598 473 411" stroke={colors.accent} strokeWidth="1.5" strokeOpacity="0.26" fill="none"/>
        <Path d="M-14 534 C145 390 273 554 457 407" stroke="#85c2fa" strokeWidth="1.3" strokeOpacity="0.18" fill="none"/>
      </Svg>
    </Animated.View>
  </View>;
}
