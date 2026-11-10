'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';
import { ConnectMusicLibrary } from './ConnectMusicSystem';

export type ProfileMediaKind = 'photos' | 'videos' | 'music';

type MediaItem = { path: string; name: string; mime: string; url: string; createdAt: string };
type Props = {
  client: SupabaseClient;
  userId: string;
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

export default function ConnectProfileMedia({ client, userId, kind, onBack, onAvatar, isOwner }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const swipeStart=useRef<{x:number;y:number}|null>(null);
  const navigatePreview=useCallback((direction:1|-1)=>{
    setPreview(old=>{
      if(!old || !items.length)return old;
      const current=items.findIndex(item=>item.path===old.path);
      return items[(Math.max(0,current)+direction+items.length)%items.length];
    });
  },[items]);
  useEffect(()=>{
    if(!preview)return;
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='ArrowLeft'){event.preventDefault();navigatePreview(-1);}
      else if(event.key==='ArrowRight'){event.preventDefault();navigatePreview(1);}
      else if(event.key==='Escape')setPreview(null);
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[preview,navigatePreview]);
  const directory = `${userId}/${kind}`;
  const heading = isOwner ? TITLES[kind] : ({ photos: 'Фото', videos: 'Видео', music: 'Музыка' } as const)[kind];

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: listError } = await client.storage.from(BUCKET).list(`${userId}/${kind}`, {
      limit: 100, sortBy: { column: 'created_at', order: 'desc' },
    });
    if (listError) {
      setError('Не удалось открыть медиатеку: ' + listError.message);
      setLoading(false);
      return;
    }
    const files = (data || []).filter(row => row.id && row.name);
    const resolved = await Promise.all(files.map(async row => {
      const path = `${userId}/${kind}/${row.name}`;
      const signed = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (!signed.data?.signedUrl) return null;
      const name = decodeName(row.name);
      const ext = extension(name);
      return { path, name, mime: MIME[ext] || 'application/octet-stream', url: playbackUrl(signed.data.signedUrl),
        createdAt: row.created_at || '' } as MediaItem;
    }));
    setItems(resolved.filter((item): item is MediaItem => item !== null));
    setLoading(false);
  }, [client, userId, kind]);

  useEffect(() => { void load(); }, [load]);

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
      if (preview?.path === item.path) setPreview(null);
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
          <button type="button" className="connect-profile-photo-thumb" onClick={() => setPreview(item)} aria-label={`Открыть ${item.name}`}><img loading="lazy" src={item.url} alt={item.name}/></button>
          <div className="connect-profile-media-item-caption" title={item.name}>{item.name}</div>
          {isOwner && <div className="connect-profile-media-item-actions"><button type="button" disabled={busy || !['image/jpeg','image/png','image/webp'].includes(item.mime)} onClick={() => void makeAvatar(item)}>На аватар</button><button type="button" disabled={busy} onClick={() => void remove(item)}>Удалить</button></div>}
        </article>)}</div>}
        {kind === 'videos' && <div className="connect-profile-video-list">{items.map(item => <article key={item.path} className="connect-profile-media-item">
          <button type="button" className="connect-profile-video-thumb" onClick={()=>setPreview(item)} aria-label={`Просмотреть ${item.name}`}><video src={item.url} preload="metadata" playsInline muted tabIndex={-1}/><span aria-hidden="true">▶</span></button>
          <div className="connect-profile-media-item-info"><strong title={item.name}>{item.name}</strong>{isOwner && <button type="button" disabled={busy} onClick={() => void remove(item)}>Удалить</button>}</div>
        </article>)}</div>}
        {kind === 'music' && <ConnectMusicLibrary client={client} ownerId={userId} items={items} isOwner={isOwner} busy={busy} onRemove={song => { const item=items.find(x=>x.path===song.path); if(item) void remove(item); }}/>}
      </>}
      <p className="connect-profile-media-hint">{isOwner ? 'Медиа доступны другим участникам Connect при просмотре твоего профиля. Максимум 100 МБ на файл.' : 'Медиа этого пользователя доступны для просмотра и прослушивания только участникам Connect.'}</p>
    </div>
    {preview && <div className="connect-profile-photo-overlay" role="dialog" aria-modal="true" aria-label={kind==='photos'?'Просмотр фотографий':'Просмотр видео'}
      onClick={()=>setPreview(null)}
      onTouchStart={e=>{const touch=e.touches[0];if(touch)swipeStart.current={x:touch.clientX,y:touch.clientY};}}
      onTouchEnd={e=>{const touch=e.changedTouches[0];const start=swipeStart.current;swipeStart.current=null;
        if(touch && start){const dx=touch.clientX-start.x;const dy=touch.clientY-start.y;
          if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.25)navigatePreview(dx>0?-1:1);
        }
      }}>
      <button type="button" className="connect-profile-photo-close" onClick={()=>setPreview(null)}>Закрыть</button>
      <span className="connect-gallery-count">{items.findIndex(item=>item.path===preview.path)+1} / {items.length}</span>
      {items.length>1 && <><button type="button" className="connect-gallery-nav connect-gallery-prev" onClick={e=>{e.stopPropagation();navigatePreview(-1);}} aria-label="Предыдущий файл">‹</button>
        <button type="button" className="connect-gallery-nav connect-gallery-next" onClick={e=>{e.stopPropagation();navigatePreview(1);}} aria-label="Следующий файл">›</button></>}
      {kind==='videos' ? <video key={preview.path} src={preview.url} playsInline controls preload="metadata" onClick={e=>e.stopPropagation()} aria-label={preview.name}/>
        : <img key={preview.path} src={preview.url} alt={preview.name} onClick={e=>e.stopPropagation()}/>}
      <span className="connect-gallery-name">{preview.name}</span>
      {isOwner && kind==='photos' && <button type="button" disabled={busy || !['image/jpeg','image/png','image/webp'].includes(preview.mime)} onClick={e=>{e.stopPropagation();void makeAvatar(preview);setPreview(null);}}>Сделать аватаром</button>}
    </div>}
  </>;
}