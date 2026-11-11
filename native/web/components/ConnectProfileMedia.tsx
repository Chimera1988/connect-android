'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';
import {readProfileLibrary,writeProfileLibrary,removeProfileLibraryItem,profilePrefetchSelection,allowProfilePrefetch,type ProfileLibraryRow} from '../lib/profile-media-index';
import {resolveCachedProfileFile,retireCachedProfileFile,purgeCachedProfileFile,prefetchProfileFile,mediaCacheEpoch,cacheLeaseValid} from '../lib/media-cache';
import {readNativeCatalog} from '../lib/native-catalog';
import { ConnectMusicLibrary } from './ConnectMusicSystem';

export type ProfileMediaKind = 'photos' | 'videos' | 'music';

type MediaItem = { path: string; name: string; mime: string; url: string; createdAt: string };
type Props = {
  client: SupabaseClient;
  userId: string;
  viewerId:string;
  kind: ProfileMediaKind;
  onBack: () => void;
  onAvatar: (file: File) => void;
  isOwner: boolean;
};

const BUCKET = 'connect-profile-media';
const TITLES: Record<ProfileMediaKind, string> = { photos: 'Мои фото', videos: 'Мои видео', music: 'Моя музыка' };
const ACCEPT: Record<ProfileMediaKind, string> = {
  photos: 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif',
  videos: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm',
  music: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/flac,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac',
};
const EXTENSIONS: Record<ProfileMediaKind, string[]> = {
  photos: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  videos: ['mp4', 'mov', 'webm'],
  music: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'webm'],
};
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
};
const MAX_SIZE = 100 * 1024 * 1024;

// Keep signed audio/video/image requests on the working same-origin proxy
// when Connect is opened through its alternate DuckDNS domain.
function playbackUrl(url: string) {
  if (typeof window === 'undefined' || window.location.hostname !== 'connect-chat.duckdns.org') return url;
  const root = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  try {
    const source = new URL(url);
    const base = new URL(root);
    if (source.hostname === base.hostname) return `${window.location.origin}/supabase${source.pathname}${source.search}${source.hash}`;
    if (source.hostname === base.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co'))
      return `${window.location.origin}/supabase-storage${source.pathname}${source.search}${source.hash}`;
  } catch { /* Signed URL may already be relative. */ }
  return url;
}

function extension(name: string) { return name.split('.').pop()?.toLowerCase() || ''; }
function validFile(file: File, kind: ProfileMediaKind) {
  return EXTENSIONS[kind].includes(extension(file.name)) && file.size > 0 && file.size <= MAX_SIZE;
}
function encodeName(name: string) {
  const ext = extension(name);
  const suffix = '.' + ext;
  const chars = Array.from(name.slice(0, -suffix.length));
  const encoder = new TextEncoder();
  while (chars.length && encoder.encode(chars.join('') + suffix).length > 88) chars.pop();
  const bytes = encoder.encode(chars.join('') + suffix);
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeName(name: string) {
  const suffix = name.split('__').slice(1).join('__');
  const encoded = suffix.replace(/\.[^.]*$/, '');
  if (!encoded) return name;
  try {
    const raw = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4));
    return new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0)));
  } catch { return name; }
}
function bytesLabel(size: number) { return `${(size / 1024 / 1024).toFixed(1)} МБ`; }

export default function ConnectProfileMedia({ client, userId, viewerId, kind, onBack, onAvatar, isOwner }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchGeneration=useRef(0);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const swipeStart=useRef<{x:number;y:number}|null>(null);
  const previewSequence=useRef(0);
  const closePreview=useCallback(()=>{previewSequence.current++;setPreview(null);},[]);
  const openPreview=useCallback(async(item:MediaItem)=>{
    const sequence=++previewSequence.current,generation=fetchGeneration.current,epoch=mediaCacheEpoch();
    const valid=()=>sequence===previewSequence.current&&generation===fetchGeneration.current&&cacheLeaseValid(viewerId,epoch);
    try{
      let url=await resolveCachedProfileFile(viewerId,item.path);
      if(!url)url=item.url.startsWith('blob:')?null:item.url;
      if(!url){const signed=await client.storage.from(BUCKET).createSignedUrl(item.path,3600);if(signed.error)throw signed.error;url=signed.data?.signedUrl?playbackUrl(signed.data.signedUrl):null;}
      if(valid()&&url)setPreview({...item,url});
    }catch(err){if(valid())setError('Не удалось открыть файл: '+(err instanceof Error?err.message:String(err)));}
  },[client,viewerId]);
  const navigatePreview=useCallback((direction:1|-1)=>{
    if(!preview||!items.length)return;
    const current=items.findIndex(item=>item.path===preview.path);
    void openPreview(items[(Math.max(0,current)+direction+items.length)%items.length]);
  },[items,preview,openPreview]);
  useEffect(()=>{
    if(!preview)return;
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='ArrowLeft'){event.preventDefault();navigatePreview(-1);}
      else if(event.key==='ArrowRight'){event.preventDefault();navigatePreview(1);}
      else if(event.key==='Escape')closePreview();
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[preview,navigatePreview]);
  const directory = `${userId}/${kind}`;
  const heading = isOwner ? TITLES[kind] : ({ photos: 'Фото', videos: 'Видео', music: 'Музыка' } as const)[kind];

  const load=useCallback(async()=>{
    const generation=++fetchGeneration.current,epoch=mediaCacheEpoch();
    const valid=()=>generation===fetchGeneration.current&&cacheLeaseValid(viewerId,epoch);
    setError('');
    const makeItem=(entry:ProfileLibraryRow,url:string):MediaItem=>{
      const name=decodeName(entry.path.split('/').pop()||'');return {path:entry.path,name,mime:MIME[extension(name)]||'application/octet-stream',url,createdAt:entry.createdAt};
    };
    const catalog=await readNativeCatalog<{items:ProfileLibraryRow[]}>(viewerId,'profile:'+userId+':'+kind).catch(()=>null);
    const previous=catalog?.value?.items||null;
    if(!valid())return;
    if(previous){const local=await Promise.all(previous.map(async row=>makeItem(row,await resolveCachedProfileFile(viewerId,row.path,row.version)||'')));if(!valid())return;setItems(local);setLoading(false);}
    try{
      const result=await client.storage.from(BUCKET).list(userId+'/'+kind,{limit:100,sortBy:{column:'created_at',order:'desc'}});
      if(!valid())return;
      if(result.error){
        if(['401','403'].includes(String((result.error as any).statusCode))){setItems([]);closePreview();for(const old of previous||[])await purgeCachedProfileFile(viewerId,old.path);await writeProfileLibrary(viewerId,userId,kind,[],catalog?.epoch);}
        throw result.error;
      }
      const rows:ProfileLibraryRow[]=(result.data||[]).filter(x=>x.id&&x.name).map(x=>({path:userId+'/'+kind+'/'+x.name,createdAt:x.created_at||'',version:x.updated_at||x.created_at||'',size:Number(x.metadata?.size)||0}));
      const locals=new Map<string,string>();
      for(const row of rows){const local=await resolveCachedProfileFile(viewerId,row.path,row.version);if(local)locals.set(row.path,local);}
      if(!valid())return;
      // Show the catalog before any URL signing. Cached entries are immediately usable.
      setItems(rows.map(x=>makeItem(x,locals.get(x.path)||'')));setLoading(false);
      await writeProfileLibrary(viewerId,userId,kind,rows,catalog?.epoch);
      if(previous&&rows.length<100){const current=new Set(rows.map(x=>x.path));for(const old of previous)if(!current.has(old.path))await removeProfileLibraryItem(viewerId,userId,kind,old.path);}
      const missing=rows.filter(x=>!locals.has(x.path));
      const signed=new Map<string,string>();
      if(missing.length){const batch=await client.storage.from(BUCKET).createSignedUrls(missing.map(x=>x.path),3600);if(!valid())return;
        if(batch.error)throw batch.error;
        for(const row of batch.data||[])if(row.path&&row.signedUrl)signed.set(row.path,playbackUrl(row.signedUrl));
      }
      if(!valid())return;setItems(rows.map(x=>makeItem(x,locals.get(x.path)||signed.get(x.path)||'')));
      if(allowProfilePrefetch()){const {cap,items}=profilePrefetchSelection(kind,rows);for(const row of items){if(!valid()||!allowProfilePrefetch())break;const url=signed.get(row.path);if(url)await prefetchProfileFile(url,viewerId,kind,cap.bytes,epoch);}}
    }catch(err){if(valid()){setLoading(false);setError((previous?'Показана локальная медиатека. Не удалось обновить: ':'Не удалось открыть медиатеку: ')+(err instanceof Error?err.message:String(err)));}}
  },[client,userId,viewerId,kind]);
  useEffect(()=>{
    setItems([]);closePreview();setLoading(true);void load();
    const visible=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);
    return()=>{fetchGeneration.current++;document.removeEventListener('visibilitychange',visible);};
  },[load]);

  async function upload(files: File[]) {
    if (!isOwner || busy || !files.length) return;
    if (files.length > 12) { setError('За один раз можно загрузить до 12 файлов.'); return; }
    setError(''); setNotice(''); setBusy(true);
    let completed = 0;
    try {
      for (const file of files) {
        if (!validFile(file, kind)) throw new Error(`Неподдерживаемый формат или размер: ${file.name}. Максимум ${bytesLabel(MAX_SIZE)}.`);
        const ext = extension(file.name);
        const path = `${directory}/${Date.now()}-${crypto.randomUUID()}__${encodeName(file.name)}.${ext}`;
        const contentType = kind === 'music' && ext === 'webm' ? 'audio/webm' : MIME[ext] || file.type || 'application/octet-stream';
        setUploadProgress(0);
        if (file.size <= 6 * 1024 * 1024) {
          const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, {
            contentType, upsert: false,
          });
          if (uploadError) throw uploadError;
        } else {
          const { data: { session } } = await client.auth.getSession();
          if (!session) throw new Error('Сессия завершена. Войдите снова.');
          const root = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const proxy = window.location.hostname === 'connect-chat.duckdns.org';
          const endpoint = proxy
            ? `${window.location.origin}/supabase-storage/storage/v1/upload/resumable`
            : `${root.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`;
          await new Promise<void>((resolve, reject) => {
            const request = new tus.Upload(file, {
              endpoint,
              retryDelays: [0, 3000, 5000, 10000, 20000],
              headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
              uploadDataDuringCreation: true,
              removeFingerprintOnSuccess: true,
              metadata: { bucketName: BUCKET, objectName: path, contentType },
              chunkSize: 6 * 1024 * 1024,
              onError: reject, onSuccess: () => resolve(),
              onProgress: (done, total) => setUploadProgress(Math.round(done / total * 100)),
            });
            request.start();
          });
        }
        completed++;
      }
      setNotice(completed === 1 ? 'Файл добавлен.' : `Загружено файлов: ${completed}.`);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) + (completed ? ` · Успешно загружено: ${completed}` : ''));
    } finally {
      setBusy(false); setUploadProgress(null); await load();
    }
  }

  async function remove(item: MediaItem) {
    if (!isOwner || busy || !window.confirm(`Удалить «${item.name}» из своей медиатеки?`)) return;
    setBusy(true); setError('');
    try {
      const { error: removeError } = await client.storage.from(BUCKET).remove([item.path]);
      if (removeError) throw removeError;
      fetchGeneration.current++;setItems(old=>old.filter(x=>x.path!==item.path));
      await removeProfileLibraryItem(viewerId,userId,kind,item.path);
      if (preview?.path === item.path) closePreview();
      setNotice('Файл удалён.');
    } catch (e) { setError('Не удалось удалить: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); await load(); }
  }

  async function makeAvatar(item: MediaItem) {
    if (!isOwner || busy || !['image/jpeg', 'image/png', 'image/webp'].includes(item.mime)) return;
    setBusy(true); setError('');
    try {
      const { data, error: downloadError } = await client.storage.from(BUCKET).download(item.path);
      if (downloadError || !data) throw downloadError || new Error('Не удалось прочитать фотографию');
      onAvatar(new File([data], item.name, { type: item.mime }));
    } catch (e) { setError('Не удалось открыть редактор аватара: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  }

  return <>
    <header className="profile-top"><button type="button" className="icon-btn" onClick={onBack} aria-label="Вернуться в мой профиль"><span aria-hidden="true" style={{ fontSize: 30, lineHeight: 1 }}>‹</span></button><strong>{heading}</strong></header>
    <div className="connect-profile-media-page">
      <div className="connect-profile-media-toolbar">
        <div><strong>{heading}</strong><small>{isOwner ? 'Медиатека профиля' : 'Медиа пользователя'} · {items.length} файлов</small></div>
        {isOwner && <><button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>+ Добавить</button>
        <input ref={inputRef} type="file" accept={ACCEPT[kind]} multiple hidden onChange={e => {
          const files = Array.from(e.currentTarget.files || []);
          e.currentTarget.value = '';
          void upload(files);
        }}/></>}
      </div>
      {busy && <div className="connect-profile-media-info" role="status">Загрузка или обработка файла…{uploadProgress !== null ? ` ${uploadProgress}%` : ''}</div>}
      {error && <div className="connect-profile-media-error" role="alert">{error}</div>}
      {notice && <div className="connect-profile-media-info" role="status">{notice}</div>}
      {loading ? <div className="connect-profile-media-empty">Загружаем медиатеку…</div> : items.length === 0 ? <div className="connect-profile-media-empty">{isOwner ? <>Здесь пока пусто. Нажми «Добавить», чтобы загрузить {kind === 'photos' ? 'фотографии' : kind === 'videos' ? 'видео' : 'музыку'}.</> : 'Пользователь ещё ничего не добавил.'}</div> : <>
        {kind === 'photos' && <div className="connect-profile-photo-grid">{items.map(item => <article key={item.path} className="connect-profile-media-item">
          <button type="button" className="connect-profile-photo-thumb" onClick={() => {void openPreview(item);}} aria-label={`Открыть ${item.name}`}><img loading="lazy" src={item.url||undefined} alt={item.name}/></button>
          <div className="connect-profile-media-item-caption" title={item.name}>{item.name}</div>
          {isOwner && <div className="connect-profile-media-item-actions"><button type="button" disabled={busy || !['image/jpeg','image/png','image/webp'].includes(item.mime)} onClick={() => void makeAvatar(item)}>На аватар</button><button type="button" disabled={busy} onClick={() => void remove(item)}>Удалить</button></div>}
        </article>)}</div>}
        {kind === 'videos' && <div className="connect-profile-video-list">{items.map(item => <article key={item.path} className="connect-profile-media-item">
          <button type="button" className="connect-profile-video-thumb" onClick={()=>{void openPreview(item);}} aria-label={`Просмотреть ${item.name}`}><video src={item.url||undefined} preload="metadata" playsInline muted tabIndex={-1}/><span aria-hidden="true">▶</span></button>
          <div className="connect-profile-media-item-info"><strong title={item.name}>{item.name}</strong>{isOwner && <button type="button" disabled={busy} onClick={() => void remove(item)}>Удалить</button>}</div>
        </article>)}</div>}
        {kind === 'music' && <ConnectMusicLibrary client={client} ownerId={userId} items={items} isOwner={isOwner} busy={busy} onRemove={song => { const item=items.find(x=>x.path===song.path); if(item) void remove(item); }}/>}
      </>}
      <p className="connect-profile-media-hint">{isOwner ? 'Медиа доступны другим участникам Connect при просмотре твоего профиля. Максимум 100 МБ на файл.' : 'Медиа этого пользователя доступны для просмотра и прослушивания только участникам Connect.'}</p>
    </div>
    {preview && <div className="connect-profile-photo-overlay" role="dialog" aria-modal="true" aria-label={kind==='photos'?'Просмотр фотографий':'Просмотр видео'}
      onClick={()=>closePreview()}
      onTouchStart={e=>{const touch=e.touches[0];if(touch)swipeStart.current={x:touch.clientX,y:touch.clientY};}}
      onTouchEnd={e=>{const touch=e.changedTouches[0];const start=swipeStart.current;swipeStart.current=null;
        if(touch && start){const dx=touch.clientX-start.x;const dy=touch.clientY-start.y;
          if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.25)navigatePreview(dx>0?-1:1);
        }
      }}>
      <button type="button" className="connect-profile-photo-close" onClick={()=>closePreview()}>Закрыть</button>
      <span className="connect-gallery-count">{items.findIndex(item=>item.path===preview.path)+1} / {items.length}</span>
      {items.length>1 && <><button type="button" className="connect-gallery-nav connect-gallery-prev" onClick={e=>{e.stopPropagation();navigatePreview(-1);}} aria-label="Предыдущий файл">‹</button>
        <button type="button" className="connect-gallery-nav connect-gallery-next" onClick={e=>{e.stopPropagation();navigatePreview(1);}} aria-label="Следующий файл">›</button></>}
      {kind==='videos' ? <video key={preview.path} src={preview.url} playsInline controls preload="metadata" onClick={e=>e.stopPropagation()} aria-label={preview.name}/>
        : <img key={preview.path} src={preview.url} alt={preview.name} onClick={e=>e.stopPropagation()}/>}
      <span className="connect-gallery-name">{preview.name}</span>
      {isOwner && kind==='photos' && <button type="button" disabled={busy || !['image/jpeg','image/png','image/webp'].includes(preview.mime)} onClick={e=>{e.stopPropagation();void makeAvatar(preview);closePreview();}}>Сделать аватаром</button>}
    </div>}
  </>;
}