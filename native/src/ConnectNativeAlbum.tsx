/** PWA-compatible mixed photo/video album: one message, up to 20 media files. */
import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Image,Pressable,Text,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {signedObject} from './nativeMediaUtils';
import {ConnectNativeMediaViewer} from './ConnectNativeMedia';
import type {Palette} from './theme';

export type AlbumItem={path:string;name:string;kind:'image'|'video'};
const PREFIX='[[connect-album:';

/** The PWA serializes the media JSON between this prefix and two closing brackets. */
export function parseAlbumReference(body:string):AlbumItem[]|null{
  if(!body.startsWith(PREFIX)||!body.endsWith(']]'))return null;
  try{
    const parsed:unknown=JSON.parse(body.slice(PREFIX.length,-2));
    if(!Array.isArray(parsed)||!parsed.length||parsed.length>20)return null;
    if(!parsed.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&
      typeof item.path==='string'&&item.path.length>4&&item.path.length<500&&
      typeof item.name==='string'&&item.name.length>0&&item.name.length<=240&&
      (item.kind==='image'||item.kind==='video')))return null;
    return parsed as AlbumItem[];
  }catch{return null;}
}

export default function ConnectNativeAlbum({items,colors}:{items:AlbumItem[];colors:Palette}){
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [selected,setSelected]=useState<number|null>(null);
  const key=items.map(x=>x.path).join('|');
  useEffect(()=>{
    let alive=true;
    setUrls({});setSelected(null);
    // Bound requests to small batches to avoid 20 parallel token/signing calls.
    void (async()=>{
      for(let start=0;start<items.length;start+=5){
        const rows=await Promise.all(items.slice(start,start+5).map(async item=>{
          try{return [item.path,(await signedObject('connect-attachments',item.path))||''] as const;}
          catch{return [item.path,''] as const;}
        }));
        if(!alive)return;
        setUrls(prev=>({...prev,...Object.fromEntries(rows)}));
      }
    })();
    return()=>{alive=false;};
    // Paths uniquely describe one album; avoid recreating signed URLs at every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);
  const active=selected===null?null:items[selected];
  const activeUrl=active?urls[active.path]:null;
  const jump=(step:number)=>setSelected(x=>x===null?null:(x+step+items.length)%items.length);
  return <>
    <View style={{width:248,flexDirection:'row',flexWrap:'wrap',gap:5}}>
      {items.map((item,index)=>{
        const url=urls[item.path];
        const resolved=Object.prototype.hasOwnProperty.call(urls,item.path);
        return <Pressable key={`${item.path}-${index}`} accessibilityRole="button" accessibilityLabel={`Открыть ${item.kind==='video'?'видео':'фото'} ${index+1} из ${items.length}`}
          onPress={()=>setSelected(index)} disabled={!url}
          style={{width:121,height:116,overflow:'hidden',borderRadius:12,backgroundColor:colors.elevated,borderWidth:1,borderColor:colors.line,alignItems:'center',justifyContent:'center'}}>
          {!resolved?<ActivityIndicator color={colors.accent}/>:!url?<Text style={{color:colors.muted,fontSize:11}}>Недоступно</Text>:item.kind==='image'?<Image source={{uri:url}} resizeMode="cover" style={{width:'100%',height:'100%'}}/>:
            <View style={{alignItems:'center',justifyContent:'center',flex:1,gap:5}}>
              <Ionicons name="play-circle-outline" size={33} color={colors.accent}/>
              <Text style={{color:colors.text,fontSize:11}}>Видео</Text>
            </View>}
          {items.length>1&&<View style={{position:'absolute',top:5,left:5,backgroundColor:'#041325bb',paddingHorizontal:5,borderRadius:5}}>
            <Text style={{color:'#fff',fontSize:10}}>{index+1}</Text>
          </View>}
        </Pressable>;
      })}
    </View>
    <Text style={{color:colors.muted,fontSize:10,marginTop:4}}>Альбом · {items.length} медиа</Text>
    {active&&activeUrl&&<ConnectNativeMediaViewer
      key={active.path} url={activeUrl} kind={active.kind==='video'?'videos':'photos'} title={active.name}
      colors={colors} onClose={()=>setSelected(null)} count={items.length} index={selected||0}
      onPrevious={()=>jump(-1)} onNext={()=>jump(1)}/>}
  </>;
}
