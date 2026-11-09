import type {Message} from './backend';

/** Match the PWA preview without exposing its serialized forwarding envelope. */
export function messagePreview(message:Message):string {
  if(message.deleted_at)return 'Нет сообщений';
  let body=message.body||'';
  if(body.startsWith('[[connect-forward:')){
    const end=body.indexOf(']]\n');
    if(end>=0)body=body.slice(end+3);
  }
  if(body.startsWith('[[connect-album:')&&body.endsWith(']]')){
    try {
      const items:unknown=JSON.parse(body.slice('[[connect-album:'.length,-2));
      if(Array.isArray(items)&&items.length>0&&items.length<=20)return `Альбом (${items.length})`;
    }catch{/* Malformed references remain plain text. */}
  }
  if(body.startsWith('[[connect-sticker:')||body.startsWith('[[connect-custom-sticker:')||
    (message.attachment_kind==='image'&&/^sticker-\d+\.(png|webp|gif|jpe?g)$/i.test(message.attachment_name||'')))return 'Стикер';
  if(message.attachment_kind==='video'&&/^connect-video-note-\d+\.(mp4|webm)$/i.test(message.attachment_name||''))return 'Видеокружок';
  return (body||({image:'Фото',video:'Видео',audio:'Голосовое сообщение',file:'Файл'}[message.attachment_kind||'file'])||'Вложение').replace(/\s+/g,' ');
}

export function listTime(value:string,now=new Date()):string {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  if(date.toDateString()===now.toDateString())return date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if(date.toDateString()===yesterday.toDateString())return 'Вчера';
  return date.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
}

/** Always release the timer, including rejected network operations. */
export async function withTimeout<T>(operation:PromiseLike<T>,ms:number,message:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([operation,new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(message)),ms);
    })]);
  }finally{if(timer!==undefined)clearTimeout(timer);}
}
