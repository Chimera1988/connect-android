import {makePhotoPreview} from './chat-thumbnails';
export type ProfileThumbnailKind='photos'|'videos'|'music';
export function profileThumbnailPath(path:string,kind:ProfileThumbnailKind):string|null{
  return kind==='photos'?path+'__thumb.webp':kind==='videos'?path+'__poster.jpg':null;
}
/** Originals remain unchanged; GIF has no still thumbnail to preserve animation. */
export async function createProfileThumbnail(file:File,kind:ProfileThumbnailKind):Promise<Blob|null>{
  if(kind==='photos')return makePhotoPreview(file);
  if(kind!=='videos'||(!file.type.startsWith('video/')&&!/\.(?:mp4|mov|webm)$/i.test(file.name)))return null;
  const src=URL.createObjectURL(file);
  return new Promise(resolve=>{
    const video=document.createElement('video');
    video.muted=true;video.playsInline=true;video.preload='auto';
    let finished=false;
    const finish=(blob:Blob|null)=>{
      if(finished)return;finished=true;window.clearTimeout(timer);
      video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(src);resolve(blob);
    };
    const timer=window.setTimeout(()=>finish(null),6000);
    const capture=()=>{
      if(finished||!video.videoWidth||!video.videoHeight||video.readyState<2)return;
      try{
        const scale=Math.min(1,480/video.videoWidth,480/video.videoHeight);
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
        canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
        const ctx=canvas.getContext('2d');if(!ctx){finish(null);return;}
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob=>finish(blob?.size?blob:null),'image/jpeg',.78);
      }catch{finish(null);}
    };
    video.onloadedmetadata=()=>{
      try{
        const target=Number.isFinite(video.duration)&&video.duration>.3?Math.min(1.2,Math.max(.3,video.duration*.12),video.duration*.8):0;
        if(target)video.currentTime=target;else if(video.readyState>=2)capture();
      }catch{capture();}
    };
    video.onseeked=capture;video.onloadeddata=capture;video.onerror=()=>finish(null);
    video.src=src;video.load();
  });
}
