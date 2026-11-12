import {Image} from 'react-native';
import {createVideoPlayer} from 'expo-video';
import {ImageManipulator,SaveFormat} from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import type {LocalUpload} from './nativeMediaUtils';

export type ChatMediaPreview={suffix:string;poster?:LocalUpload;thumbnail?:LocalUpload};
const dimension=(value:number)=>Math.max(1,Math.min(99999,Math.round(value)));
const suffix=(kind:'img'|'vid',width:number,height:number)=>width>0&&height>0?`__${kind}_${dimension(width)}x${dimension(height)}`:'';

/** Match PWA attachment keys; metadata/thumbnail failures never discard the selected original. */
export async function prepareChatMediaPreview(file:LocalUpload,kind:string):Promise<ChatMediaPreview>{
  if(kind==='image'){
    const dimensions=await new Promise<{width:number;height:number}|null>(resolve=>{
      const timer=setTimeout(()=>resolve(null),5000);
      Image.getSize(file.uri,(width,height)=>{clearTimeout(timer);resolve({width,height});},()=>{clearTimeout(timer);resolve(null);});
    });
    const mediaSuffix=dimensions?suffix('img',dimensions.width,dimensions.height):'';
    if(!mediaSuffix||file.mime==='image/gif')return {suffix:mediaSuffix};
    try{
      const context=ImageManipulator.manipulate(file.uri,{maxWidth:480,maxHeight:480});
      try{
        const image=await context.renderAsync();
        try{
          const saved=await image.saveAsync({format:SaveFormat.WEBP,compress:.78});
          return {suffix:mediaSuffix,thumbnail:{uri:saved.uri,name:'thumbnail.webp',mime:'image/webp'}};
        }finally{image.release();}
      }finally{context.release();}
    }catch{return {suffix:mediaSuffix};}
  }
  if(kind!=='video')return {suffix:''};
  const player=createVideoPlayer(file.uri);
  let mediaSuffix='';
  try{
    player.muted=true;
    await new Promise<void>((resolve,reject)=>{
      let settled=false;
      const finish=(error?:Error)=>{
        if(settled)return;settled=true;clearTimeout(timer);load.remove();status.remove();
        if(error)reject(error);else resolve();
      };
      const load=player.addListener('sourceLoad',event=>{
        const size=event.availableVideoTracks[0]?.size;
        if(size)mediaSuffix=suffix('vid',size.width,size.height);
        finish();
      });
      const status=player.addListener('statusChange',event=>{if(event.status==='error')finish(new Error('Видео не декодируется'));});
      const timer=setTimeout(()=>finish(new Error('Время подготовки видео истекло')),8000);
      if(player.status==='readyToPlay'){
        const size=player.availableVideoTracks[0]?.size;
        if(size)mediaSuffix=suffix('vid',size.width,size.height);
        finish();
      }
    });
    const frames=await player.generateThumbnailsAsync(Math.min(.2,Math.max(0,player.duration-.01)),{maxWidth:480,maxHeight:480});
    const frame=frames[0];
    if(!frame)return {suffix:mediaSuffix};
    try{
      if(!mediaSuffix)mediaSuffix=suffix('vid',frame.width,frame.height);
      const context=ImageManipulator.manipulate(frame,{maxWidth:480,maxHeight:480});
      try{
        const image=await context.renderAsync();
        try{
          const saved=await image.saveAsync({format:SaveFormat.JPEG,compress:.78});
          return {suffix:mediaSuffix,poster:{uri:saved.uri,name:'poster.jpg',mime:'image/jpeg'}};
        }finally{image.release();}
      }finally{context.release();}
    }finally{for(const item of frames)item.release();}
  }catch{
    return {suffix:mediaSuffix};
  }finally{player.release();}
}

export async function discardChatMediaPreview(preview:ChatMediaPreview){
  if(preview.poster)await FileSystem.deleteAsync(preview.poster.uri,{idempotent:true}).catch(()=>{});
  if(preview.thumbnail)await FileSystem.deleteAsync(preview.thumbnail.uri,{idempotent:true}).catch(()=>{});
}
