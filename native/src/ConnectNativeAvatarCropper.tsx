/** PWA avatar cropping: reposition, pinch/zoom, exact 512x512 JPEG crop. */
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Image,Modal,Pressable,Text,View} from 'react-native';
import {ImageManipulator,SaveFormat} from 'expo-image-manipulator';
import {File} from 'expo-file-system';
import type {Palette} from './theme';

export type AvatarSource={uri:string;width:number;height:number};
export type CroppedAvatar={uri:string;size:number};
type Props={source:AvatarSource|null;colors:Palette;busy:boolean;onClose:()=>void;onSave:(file:CroppedAvatar)=>Promise<void>};
const STAGE=280;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
function distance(a:{pageX:number;pageY:number},b:{pageX:number;pageY:number}){
  return Math.hypot(a.pageX-b.pageX,a.pageY-b.pageY);
}
export default function ConnectNativeAvatarCropper({source,colors,busy,onClose,onSave}:Props){
  const [zoom,setZoom]=useState(1);
  const [offset,setOffset]=useState({x:0,y:0});
  const [progress,setProgress]=useState(false);
  const [error,setError]=useState('');
  const zoomRef=useRef(1),offsetRef=useRef({x:0,y:0});
  const pointer=useRef<{count:number;x:number;y:number;distance:number}>({count:0,x:0,y:0,distance:0});
  useEffect(()=>{zoomRef.current=1;offsetRef.current={x:0,y:0};setZoom(1);setOffset({x:0,y:0});setError('');},[source?.uri]);
  const working=busy||progress;
  const width=source?.width||1,height=source?.height||1;
  const base=Math.max(STAGE/width,STAGE/height);
  const displayedW=width*base*zoom,displayedH=height*base*zoom;
  function update(z:number,x:number,y:number){
    const next=clamp(z,1,4);
    const maxX=Math.max(0,(width*base*next-STAGE)/2);
    const maxY=Math.max(0,(height*base*next-STAGE)/2);
    const point={x:clamp(x,-maxX,maxX),y:clamp(y,-maxY,maxY)};
    zoomRef.current=next;offsetRef.current=point;
    setZoom(next);setOffset(point);
  }
  function touchStart(touches:readonly {pageX:number;pageY:number}[]){
    if(working)return;
    if(touches.length>=2){pointer.current={count:2,x:0,y:0,distance:distance(touches[0],touches[1])};}
    else if(touches.length===1){pointer.current={count:1,x:touches[0].pageX,y:touches[0].pageY,distance:0};}
    else pointer.current={count:0,x:0,y:0,distance:0};
  }
  function touchMove(touches:readonly {pageX:number;pageY:number}[]){
    if(working)return;
    const current=pointer.current;
    if(touches.length>=2){
      const d=distance(touches[0],touches[1]);
      if(current.count===2 && current.distance>0)
        update(zoomRef.current*d/current.distance,offsetRef.current.x,offsetRef.current.y);
      pointer.current={count:2,x:0,y:0,distance:d};
    }else if(touches.length===1){
      const point=touches[0];
      if(current.count===1)
        update(zoomRef.current,offsetRef.current.x+point.pageX-current.x,offsetRef.current.y+point.pageY-current.y);
      pointer.current={count:1,x:point.pageX,y:point.pageY,distance:0};
    }
  }
  async function save(){
    if(!source||working)return;
    setProgress(true);setError('');
    try{
      const scale=base*zoomRef.current;
      const side=STAGE/scale;
      const left=(STAGE-width*scale)/2+offsetRef.current.x;
      const top=(STAGE-height*scale)/2+offsetRef.current.y;
      const originX=clamp(-left/scale,0,Math.max(0,width-side));
      const originY=clamp(-top/scale,0,Math.max(0,height-side));
      const context=ImageManipulator.manipulate(source.uri);
      context.crop({originX,originY,width:side,height:side}).resize({width:512,height:512});
      const rendered=await context.renderAsync();
      let saved=await rendered.saveAsync({format:SaveFormat.JPEG,compress:.88});
      let size=new File(saved.uri).size;
      if(size>2*1024*1024){saved=await rendered.saveAsync({format:SaveFormat.JPEG,compress:.67});size=new File(saved.uri).size;}
      if(size<=0||size>2*1024*1024)throw Error('JPEG аватар должен быть не более 2 МБ');
      await onSave({uri:saved.uri,size});
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setProgress(false);}
  }
  return <Modal visible={Boolean(source)} animationType="slide" presentationStyle="fullScreen" onRequestClose={()=>{if(!working)onClose();}}>
    <View style={{flex:1,backgroundColor:colors.bg,paddingHorizontal:16,paddingTop:22,paddingBottom:25,justifyContent:'space-between'}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <Pressable accessibilityRole="button" disabled={working} onPress={onClose} style={{padding:12}}><Text style={{color:colors.accent}}>Отмена</Text></Pressable>
        <Text style={{color:colors.text,fontWeight:'800',fontSize:19}}>Фото профиля</Text>
        <Pressable accessibilityRole="button" disabled={working||!source} onPress={()=>void save()} style={{padding:12}}><Text style={{color:colors.accent,fontWeight:'700'}}>Готово</Text></Pressable>
      </View>
      <View style={{alignItems:'center',justifyContent:'center',gap:14}}>
        <Text style={{color:colors.muted,textAlign:'center',fontSize:13}}>Перемести фотографию и выбери нужный участок</Text>
        <View style={{width:STAGE,height:STAGE,overflow:'hidden',backgroundColor:colors.elevated,borderRadius:12}}
          onTouchStart={e=>touchStart(e.nativeEvent.touches)}
          onTouchMove={e=>touchMove(e.nativeEvent.touches)}
          onTouchEnd={e=>touchStart(e.nativeEvent.touches)}
          onTouchCancel={()=>touchStart([])}>
          {source&&<Image source={{uri:source.uri}} resizeMode="stretch" pointerEvents="none"
            style={{position:'absolute',width:displayedW,height:displayedH,
              left:(STAGE-displayedW)/2+offset.x,top:(STAGE-displayedH)/2+offset.y}}/>}
          <View pointerEvents="none" style={{position:'absolute',left:1,top:1,right:1,bottom:1,borderRadius:140,borderColor:'rgba(255,255,255,.8)',borderWidth:2}}/>
        </View>
        <View style={{flexDirection:'row',alignItems:'center',gap:15}}>
          <Pressable accessibilityRole="button" accessibilityLabel="Уменьшить" onPress={()=>update(zoomRef.current-.25,offsetRef.current.x,offsetRef.current.y)} disabled={working} style={{padding:12}}><Text style={{fontSize:24,color:colors.accent}}>−</Text></Pressable>
          <Text style={{color:colors.text,fontSize:14,width:70,textAlign:'center'}}>{Math.round(zoom*100)}%</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Увеличить" onPress={()=>update(zoomRef.current+.25,offsetRef.current.x,offsetRef.current.y)} disabled={working} style={{padding:12}}><Text style={{fontSize:24,color:colors.accent}}>+</Text></Pressable>
        </View>
        <Text style={{color:colors.muted,textAlign:'center',fontSize:12}}>Масштаб 1–4× · два пальца для увеличения · сохраняется JPEG 512×512</Text>
        {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger,textAlign:'center'}}>{error}</Text>}
      </View>
      <View style={{height:40,justifyContent:'center'}}>{working&&<ActivityIndicator color={colors.accent}/>}</View>
    </View>
  </Modal>;
}
