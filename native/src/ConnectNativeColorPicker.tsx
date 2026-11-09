import React,{useEffect,useId,useRef,useState} from 'react';
import {Text,View} from 'react-native';
import Svg,{Defs,LinearGradient,Rect,Stop} from 'react-native-svg';
import {hexToHsv,hsvToHex,unit,type HsvColor} from './nativeColorUtils';
import type {Palette} from './theme';

function ColorSlider({label,value,stops,onChange,colors,degrees=false}:{label:string;value:number;stops:string[];onChange:(value:number)=>void;colors:Palette;degrees?:boolean}){
  const width=useRef(1);
  const id='color-'+useId().replace(/[^a-zA-Z0-9]/g,'');
  const maximum=degrees?360:100;
  return <View style={{gap:2}}>
    <View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{fontSize:12,color:colors.muted}}>{label}</Text><Text style={{fontSize:12,color:colors.muted}}>{Math.round(value*maximum)}{degrees?'°':'%'}</Text></View>
    <View accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{min:0,max:maximum,now:Math.round(value*maximum)}}
      accessibilityActions={[{name:'increment',label:'Увеличить'},{name:'decrement',label:'Уменьшить'}]}
      onAccessibilityAction={event=>{
        if(event.nativeEvent.actionName==='increment')onChange(unit(value+.05));
        else if(event.nativeEvent.actionName==='decrement')onChange(unit(value-.05));
      }}
      onLayout={event=>{width.current=Math.max(1,event.nativeEvent.layout.width);}}
      onStartShouldSetResponder={()=>true} onMoveShouldSetResponder={()=>true}
      onResponderGrant={event=>onChange(unit(event.nativeEvent.locationX/width.current))}
      onResponderMove={event=>onChange(unit(event.nativeEvent.locationX/width.current))}
      style={{height:36,justifyContent:'center'}}>
      <Svg pointerEvents="none" width="100%" height="16">
        <Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">{stops.map((color,index)=><Stop key={index} offset={index/(stops.length-1)} stopColor={color}/>)}</LinearGradient></Defs>
        <Rect width="100%" height="16" rx="8" fill={`url(#${id})`}/>
      </Svg>
      <View pointerEvents="none" style={{position:'absolute',top:6,left:`${value*100}%`,marginLeft:-9,width:18,height:24,borderRadius:9,borderColor:'#fff',borderWidth:3,backgroundColor:'transparent',shadowColor:'#000',shadowOpacity:.5,shadowRadius:2,elevation:3}}/>
    </View>
  </View>;
}

/** Native equivalent of the PWA's arbitrary color chooser; HEX input remains alongside it. */
export default function ConnectNativeColorPicker({value,onChange,colors}:{value:string;onChange:(hex:string)=>void;colors:Palette}){
  const [hsv,setHsv]=useState<HsvColor>(()=>hexToHsv(value)||{h:210,s:1,v:1});
  const current=useRef(hsv);
  const emitted=useRef(value.toLowerCase());
  const plane=useRef({width:1,height:1});
  const id='plane-'+useId().replace(/[^a-zA-Z0-9]/g,'');
  useEffect(()=>{
    // Keep hue/saturation while dragging through white or black, where RGB loses them.
    if(value.toLowerCase()===emitted.current)return;
    const next=hexToHsv(value);
    if(next){current.current=next;setHsv(next);emitted.current=value.toLowerCase();}
  },[value]);
  function update(patch:Partial<HsvColor>){
    const next={...current.current,...patch};
    current.current=next;setHsv(next);
    emitted.current=hsvToHex(next);onChange(emitted.current);
  }
  function choosePlane(x:number,y:number){update({s:unit(x/plane.current.width),v:1-unit(y/plane.current.height)});}
  const hue=hsvToHex({h:hsv.h,s:1,v:1});
  return <View style={{gap:8}}>
    <Text style={{color:colors.text,fontSize:13,fontWeight:'600'}}>Свой цвет</Text>
    <View accessibilityLabel="Палитра цвета. Насыщенность и яркость также доступны ползунками ниже."
      onLayout={event=>{plane.current={width:Math.max(1,event.nativeEvent.layout.width),height:Math.max(1,event.nativeEvent.layout.height)};}}
      onStartShouldSetResponder={()=>true} onMoveShouldSetResponder={()=>true}
      onResponderGrant={event=>choosePlane(event.nativeEvent.locationX,event.nativeEvent.locationY)}
      onResponderMove={event=>choosePlane(event.nativeEvent.locationX,event.nativeEvent.locationY)}
      style={{height:150,borderRadius:12,overflow:'hidden',borderWidth:1,borderColor:colors.line}}>
      <Svg pointerEvents="none" width="100%" height="100%">
        <Defs>
          <LinearGradient id={id+'-s'} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#fff"/><Stop offset="1" stopColor={hue}/></LinearGradient>
          <LinearGradient id={id+'-v'} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#000" stopOpacity="0"/><Stop offset="1" stopColor="#000" stopOpacity="1"/></LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id}-s)`}/>
        <Rect width="100%" height="100%" fill={`url(#${id}-v)`}/>
      </Svg>
      <View pointerEvents="none" style={{position:'absolute',left:`${hsv.s*100}%`,top:`${(1-hsv.v)*100}%`,width:18,height:18,marginLeft:-9,marginTop:-9,borderRadius:9,borderWidth:2,borderColor:'#fff',backgroundColor:'transparent'}}/>
    </View>
    <ColorSlider label="Оттенок" colors={colors} value={hsv.h/360} degrees stops={['#ff0000','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff','#ff0000']} onChange={fraction=>update({h:fraction*360})}/>
    <ColorSlider label="Насыщенность" colors={colors} value={hsv.s} stops={[hsvToHex({...hsv,s:0}),hsvToHex({...hsv,s:1})]} onChange={s=>update({s})}/>
    <ColorSlider label="Яркость" colors={colors} value={hsv.v} stops={['#000000',hsvToHex({...hsv,v:1})]} onChange={v=>update({v})}/>
  </View>;
}
