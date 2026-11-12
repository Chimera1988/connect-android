'use client';

import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

export type ConnectGalleryItem = {
  path:string;
  url:string;
  name:string;
  kind:'image'|'video';
  messageId?:string;
  createdAt?:string;
  senderId?:string;
};
type Props = {
  items:ConnectGalleryItem[];
  currentPath:string;
  onClose:()=>void;
  onStep:(delta:1|-1)=>void;
  onSave:(item:ConnectGalleryItem)=>void|Promise<void>;
  onFetch:(item:ConnectGalleryItem)=>Promise<Blob>;
  onForward?:(item:ConnectGalleryItem)=>void;
  onJump?:(item:ConnectGalleryItem)=>void;
  onAvatar?:(item:ConnectGalleryItem)=>void;
};
type IconName = 'close'|'download'|'more'|'copy'|'share'|'jump'|'forward'|'avatar';
function GalleryIcon({name}:{name:IconName}) {
  const common={fill:'none',stroke:'currentColor',strokeWidth:1.85,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  const path:Record<IconName,React.ReactNode>={
    close:<path d="M5 5 19 19M19 5 5 19"/>,
    download:<><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></>,
    more:<><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>,
    copy:<><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>,
    share:<><path d="M12 15V3m-5 5 5-5 5 5"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></>,
    jump:<><path d="M4 7v11a2 2 0 0 0 2 2h11"/><path d="M9 11h11m-5-5 5 5-5 5"/></>,
    forward:<><path d="m13 5 7 7-7 7M20 12H9a5 5 0 0 0-5 5v2"/></>,
    avatar:<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  };
  return <svg width="25" height="25" viewBox="0 0 24 24" aria-hidden="true" {...common}>{path[name]}</svg>;
}

// This is a single viewport-level gallery, shared by chat attachments and profile libraries.
// URLs remain ephemeral: do not persist signed URLs or media bytes in this component.
export default function ConnectGalleryViewer({items,currentPath,onClose,onStep,onSave,onFetch,onForward,onJump,onAvatar}:Props) {
  const [menu,setMenu]=useState(false);
  const [status,setStatus]=useState('');
  const [working,setWorking]=useState(false);
  const touch=useRef<{x:number;y:number}|null>(null);
  const index=items.findIndex(item=>item.path===currentPath);
  const current=index<0?undefined:items[index];
  useEffect(()=>{setMenu(false);setStatus('');},[currentPath]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();if(menu)setMenu(false);else onClose();}
      if(event.key==='ArrowLeft'&&index>0){event.preventDefault();onStep(-1);}
      if(event.key==='ArrowRight'&&index>=0&&index<items.length-1){event.preventDefault();onStep(1);}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[menu,index,items.length,onClose,onStep]);
  useEffect(()=>{
    for(const i of [index-1,index+1]) {
      if(items[i]?.kind==='image'){const image=new Image();image.src=items[i].url;}
    }
  },[items,index]);
  const copy=async()=>{
    if(!current||current.kind!=='image')return;
    setWorking(true);setStatus('');
    try{
      if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw new Error('Копирование фото не поддерживается этим браузером');
      const png=(async()=>{
        const original=await onFetch(current);
        if(original.type==='image/png')return original;
        const bitmap=await createImageBitmap(original);
        try{
          const canvas=document.createElement('canvas');
          canvas.width=bitmap.width;canvas.height=bitmap.height;
          const ctx=canvas.getContext('2d');
          if(!ctx)throw new Error('Недоступен графический контекст');
          ctx.drawImage(bitmap,0,0);
          return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось подготовить фото')),'image/png'));
        }finally{bitmap.close();}
      })();
      await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
      setStatus('Фото скопировано');
    }catch(e){setStatus(e instanceof Error?e.message:'Не удалось скопировать фото');}
    finally{setWorking(false);}
  };
  const share=async()=>{
    if(!current)return;
    setStatus('');
    if(!navigator.share){setStatus('Системное меню «Поделиться» недоступно');return;}
    try{
      // Invoke Share synchronously in the click handler; iOS requires user activation.
      await navigator.share({title:current.name,url:current.url});
    }catch(e){if((e as Error).name!=='AbortError')setStatus('Не удалось поделиться файлом');}
  };
  const itemButton=(name:IconName,label:string,action:()=>void|Promise<void>)=><button type="button" role="menuitem" className="connect-full-gallery-menu-item" onClick={e=>{e.stopPropagation();setMenu(false);void action();}}><GalleryIcon name={name}/><span>{label}</span></button>;
  if(!current)return null;
  return createPortal(<div className="connect-full-gallery" role="dialog" aria-modal="true" aria-label="Просмотр медиа" onClick={()=>{if(menu)setMenu(false);}}>
    <header className="connect-full-gallery-header" onClick={e=>e.stopPropagation()}>
      <button type="button" className="connect-full-gallery-icon" onClick={onClose} aria-label="Закрыть просмотр"><GalleryIcon name="close"/></button>
      <strong className="connect-full-gallery-counter">{index+1} / {items.length}</strong>
      <button type="button" className="connect-full-gallery-icon" disabled={working} onClick={()=>void onSave(current)} aria-label="Сохранить файл"><GalleryIcon name="download"/></button>
      <button type="button" className="connect-full-gallery-icon" aria-label="Действия с медиа" aria-expanded={menu} onClick={()=>setMenu(value=>!value)}><GalleryIcon name="more"/></button>
      {menu && <div className="connect-full-gallery-menu" role="menu" aria-label="Действия с медиа">
        {current.kind==='image' && itemButton('copy','Скопировать',copy)}
        {itemButton('share','Поделиться',share)}
        {onJump&&current.messageId && itemButton('jump','Перейти к сообщению',()=>onJump(current))}
        {onForward&&current.messageId && itemButton('forward',current.kind==='image'?'Отправить фото':'Отправить видео',()=>onForward(current))}
        {onAvatar&&current.kind==='image' && itemButton('avatar','Сделать аватаром',()=>onAvatar(current))}
      </div>}
    </header>
    <div className="connect-full-gallery-stage" onClick={e=>e.stopPropagation()}
      onTouchStart={e=>{const t=e.touches[0];if(t)touch.current={x:t.clientX,y:t.clientY};}}
      onTouchEnd={e=>{const a=touch.current,b=e.changedTouches[0];touch.current=null;if(!a||!b)return;const dx=b.clientX-a.x,dy=b.clientY-a.y;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.3){if(dx<0&&index<items.length-1)onStep(1);else if(dx>0&&index>0)onStep(-1);}}}>
      {current.kind==='image'
        ? <img key={current.path} src={current.url} draggable={false} alt="Фото в галерее"/>
        : <video key={current.path} src={current.url} controls playsInline preload="metadata" autoPlay aria-label="Видео в галерее"/>}
    </div>
    {status && <div className="connect-full-gallery-status" role="status" onClick={e=>e.stopPropagation()}>{status}</div>}
  </div>,document.body);
}
