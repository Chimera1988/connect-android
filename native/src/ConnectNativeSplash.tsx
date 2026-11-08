/** Exact Silver Night assets and startup progress semantics from the Connect PWA.
 * Browser CSS is adapted with React Native + react-native-svg; no WebView.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Image, StyleSheet, useWindowDimensions, View} from 'react-native';
import Svg, {Defs, LinearGradient, Path, RadialGradient, Rect, Stop} from 'react-native-svg';
import * as NativeSplash from 'expo-splash-screen';

// Hold the platform splash until the first native splash overlay layout.
void NativeSplash.preventAutoHideAsync().catch(() => {});

const CUTS = [0, 17.6, 32.6, 46.7, 61.1, 75.8, 89.6, 100] as const;
const LETTER_COUNT = 7;

type Props = {ready: boolean; onComplete: () => void};

function Backdrop() {
  return <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%"
    viewBox="0 0 430 900" preserveAspectRatio="xMidYMid slice">
    <Defs>
      <LinearGradient id="night" x1="0%" y1="0%" x2="33%" y2="100%">
        <Stop offset="0%" stopColor="#090e14"/><Stop offset="50%" stopColor="#0b131c"/>
        <Stop offset="100%" stopColor="#0a1017"/>
      </LinearGradient>
      <RadialGradient id="leftGlow" cx="0%" cy="22%" rx="95%" ry="57%">
        <Stop offset="0%" stopColor="#576979" stopOpacity=".17"/>
        <Stop offset="72%" stopColor="#576979" stopOpacity="0"/>
      </RadialGradient>
      <RadialGradient id="rightGlow" cx="100%" cy="76%" rx="120%" ry="67%">
        <Stop offset="0%" stopColor="#4b6278" stopOpacity=".25"/>
        <Stop offset="72%" stopColor="#4b6278" stopOpacity="0"/>
      </RadialGradient>
    </Defs>
    <Rect width="430" height="900" fill="url(#night)"/>
    <Rect width="430" height="900" fill="url(#leftGlow)"/>
    <Rect width="430" height="900" fill="url(#rightGlow)"/>
  </Svg>;
}
function Waves({upper}:{upper:boolean}) {
  return <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 430 900"
    preserveAspectRatio="xMidYMid slice">
    <Defs>
      <LinearGradient id="upperFill" x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0%" stopColor="#a7bdcc" stopOpacity=".12"/>
        <Stop offset="50%" stopColor="#465c70" stopOpacity=".18"/>
        <Stop offset="100%" stopColor="#09131e" stopOpacity=".02"/>
      </LinearGradient>
      <LinearGradient id="lowerFill" x1="0%" y1="0%" x2="70%" y2="100%">
        <Stop offset="0%" stopColor="#bbcbd8" stopOpacity=".02"/>
        <Stop offset="43%" stopColor="#526c82" stopOpacity=".25"/>
        <Stop offset="100%" stopColor="#1b3145" stopOpacity=".22"/>
      </LinearGradient>
      <LinearGradient id="edge" x1="0%" y1="0%" x2="100%" y2="0%">
        <Stop offset="0%" stopColor="#859aa9" stopOpacity=".04"/>
        <Stop offset="42%" stopColor="#dceaf4" stopOpacity=".55"/>
        <Stop offset="100%" stopColor="#b0cadb" stopOpacity=".12"/>
      </LinearGradient>
    </Defs>
    {upper ? <>
      <Path d="M-80 250 C80 265 181 199 285 116 S438 43 520 -18 L520 -90 L-80 -90Z" fill="url(#upperFill)"/>
      <Path d="M-80 250 C80 265 181 199 285 116 S438 43 520 -18" fill="none" stroke="url(#edge)" strokeWidth="2"/>
      <Path d="M-90 305 C100 245 191 213 317 163 S450 110 520 97" fill="none" stroke="#687f93" strokeWidth="1" strokeOpacity=".27"/>
    </> : <>
      <Path d="M-80 676 C79 787 153 751 260 677 S418 587 530 601 L530 990 L-80 990Z" fill="url(#lowerFill)" opacity=".95"/>
      <Path d="M-80 676 C79 787 153 751 260 677 S418 587 530 601" fill="none" stroke="url(#edge)" strokeWidth="2.4"/>
      <Path d="M-100 754 C87 823 169 767 264 717 S436 687 540 651" fill="none" stroke="#92a9b9" strokeOpacity=".6" strokeWidth="2"/>
      <Path d="M-100 809 C75 883 193 794 300 763 S424 738 536 722" fill="none" stroke="#536f84" strokeOpacity=".25" strokeWidth="1"/>
    </>}
  </Svg>;
}

export default function ConnectNativeSplash({ready, onComplete}: Props) {
  const {width, height} = useWindowDimensions();
  const [letters, setLetters] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const finish = useCallback(() => onCompleteRef.current(), []);
  const nativeReleased = useRef(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const driftTop = useRef(new Animated.Value(0)).current;
  const driftBottom = useRef(new Animated.Value(1)).current;
  const slices = useRef(Array.from({length: LETTER_COUNT}, () => new Animated.Value(0))).current;

  useEffect(() => {
    const top = Animated.loop(Animated.sequence([
      Animated.timing(driftTop, {toValue: 1, duration: 9000, useNativeDriver: true}),
      Animated.timing(driftTop, {toValue: 0, duration: 9000, useNativeDriver: true}),
    ]));
    const bottom = Animated.loop(Animated.sequence([
      Animated.timing(driftBottom, {toValue: 0, duration: 12000, useNativeDriver: true}),
      Animated.timing(driftBottom, {toValue: 1, duration: 12000, useNativeDriver: true}),
    ]));
    top.start(); bottom.start();
    return () => {top.stop(); bottom.stop();};
  }, [driftTop, driftBottom]);
  useEffect(() => {
    if (letters >= LETTER_COUNT - 1) return;
    const t = setTimeout(() => setLetters(n => n + 1), 200);
    return () => clearTimeout(t);
  }, [letters]);
  useEffect(() => {
    if (!ready || letters !== LETTER_COUNT - 1) return;
    const t = setTimeout(() => setLetters(LETTER_COUNT), 200);
    return () => clearTimeout(t);
  }, [ready, letters]);
  useEffect(() => {
    if (letters < 1 || letters > LETTER_COUNT) return;
    const a = Animated.timing(slices[letters - 1], {toValue: 1, duration: 260, useNativeDriver: true});
    a.start();
    return () => a.stop();
  }, [letters, slices]);
  useEffect(() => {
    if (!ready || letters !== LETTER_COUNT) return;
    const fadeTimer = setTimeout(() => setLeaving(true), 300);
    const doneTimer = setTimeout(finish, 750);
    return () => {clearTimeout(fadeTimer); clearTimeout(doneTimer);};
  }, [ready, letters, finish]);
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(opacity, {toValue: 0, duration: 420, useNativeDriver: true}).start();
  }, [leaving, opacity]);
  // The PWA's same escape hatch: a network fault must not trap users behind loading.
  useEffect(() => {const t=setTimeout(finish, 12000); return () => clearTimeout(t);}, [finish]);

  const iconWidth = height < 570 ? Math.min(height * .3, 185) : Math.min(width * .47, 220);
  const wordWidth = height < 570 ? Math.min(width * .46, 290) : Math.min(width * .48, 347);
  const wordHeight = wordWidth * (66 / 347);
  const topMovement = {transform: [
    {translateX: driftTop.interpolate({inputRange:[0,1], outputRange:[-width*.02, width*.02]})},
    {translateY: driftTop.interpolate({inputRange:[0,1], outputRange:[0,-height*.006]})},
    {scale: driftTop.interpolate({inputRange:[0,1], outputRange:[1.01,1.035]})},
  ]};
  const bottomMovement = {transform: [
    {translateX: driftBottom.interpolate({inputRange:[0,1], outputRange:[-width*.02, width*.02]})},
    {translateY: driftBottom.interpolate({inputRange:[0,1], outputRange:[0,-height*.006]})},
    {scale: driftBottom.interpolate({inputRange:[0,1], outputRange:[1.01,1.035]})},
  ]};

  return <Animated.View accessibilityLabel="Загрузка Connect" accessibilityRole="progressbar"
    onLayout={() => {
      if (nativeReleased.current) return;
      nativeReleased.current = true;
      void NativeSplash.hideAsync().catch(() => {});
    }}
    style={[StyleSheet.absoluteFill, {backgroundColor: '#090e14', zIndex: 1000, opacity}]}
    pointerEvents="auto">
    <Backdrop/>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, topMovement]}><Waves upper/></Animated.View>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, bottomMovement]}><Waves upper={false}/></Animated.View>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
      alignItems: 'center', justifyContent: 'center', transform: [{translateY: -height * .056}],
    }]}>
      <Image source={require('../assets/connect-splash-bubbles.png')}
        style={{width: iconWidth, height: iconWidth}} resizeMode="contain"/>
      <View style={{width: wordWidth, height: wordHeight, marginTop: -2}}>
        {CUTS.slice(0, -1).map((start, index) => {
          const left = (start / 100) * wordWidth;
          const sliceWidth = ((CUTS[index + 1] - start) / 100) * wordWidth + .5;
          return <Animated.View key={index} style={{
            position: 'absolute', top: 0, bottom: 0, left, width: sliceWidth,
            overflow: 'hidden', opacity: slices[index],
          }}>
            <Image source={require('../assets/connect-splash-wordmark.png')} resizeMode="stretch"
              style={{position: 'absolute', top: 0, left: -left, width: wordWidth, height: wordHeight}}/>
          </Animated.View>;
        })}
      </View>
    </View>
  </Animated.View>;
}
