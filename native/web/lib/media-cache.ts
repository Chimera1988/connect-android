/** Separate database: clearing media never touches auth, keys, history or outbox. */
import {chatHistoryStats} from './chat-history-cache';
export type CacheCategory = 'system' | 'photos' | 'videos' | 'audio' | 'other';
type Entry = {
    key: string;
    user: string;
    category: CacheCategory;
    size: number;
    used: number;
    blob?: Blob;
    bytes?: ArrayBuffer;
    type?: string;
};
const NAME = 'connect-media-v1', STORE = 'objects';
let opening: Promise<IDBDatabase> | undefined;
let owner = '';
let historyBudgetOwner='',historyBytes=0,historyBudgetAt=0,historyBudgetPending:Promise<void>|undefined;
async function nativeHistoryBytes(){
    if(!owner)return 0;
    if(historyBudgetOwner!==owner){historyBudgetOwner=owner;historyBytes=0;historyBudgetAt=0;historyBudgetPending=undefined;}
    if(Date.now()-historyBudgetAt>2500&&!historyBudgetPending){const user=owner;historyBudgetPending=chatHistoryStats(user).then(s=>{if(owner===user){historyBytes=s.bytes;historyBudgetAt=Date.now();}}).catch(()=>{if(owner===user)historyBudgetAt=Date.now();}).finally(()=>{if(owner===user)historyBudgetPending=undefined;});}
    await historyBudgetPending;return historyBytes;
}
const objectUrls = new Map<string, string>(), pending = new Map<string, Promise<void>>();
const originals = new Map<string, string>();
type MediaElement = HTMLImageElement | HTMLMediaElement;
type Binding = { source: string; current: string; retried: boolean };
const bindings = new Map<MediaElement, Binding>();
function restoreUrl(url: string) {
    for (const [element, binding] of bindings) {
        if (element.getAttribute('src') === url) {
            binding.current = binding.source;
            element.src = binding.source;
        }
    }
    URL.revokeObjectURL(url);
    originals.delete(url);
}
function contentType(key: string, type = '') {
    type = type.split(';')[0].toLowerCase();
    if (type && type !== 'application/octet-stream') return type;
    const extension = key.split('.').pop()?.toLowerCase();
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[extension || ''] || type;
}
function usableType(type: string) { return !/^(?:text\/html|application\/(?:json|xhtml\+xml))$/.test(type); }
const LIMITS = { '500': 500 * 1024 ** 2, '1000': 1024 ** 3, '2000': 2 * 1024 ** 3, auto: 500 * 1024 ** 2 };
export function mediaIdentity(url: string): string | null {
    try {
        const u = new URL(url, location.href);
        if (u.origin !== location.origin && !['tpwkmoxxzjfdsqsomhhr.supabase.co', 'tpwkmoxxzjfdsqsomhhr.storage.supabase.co', 'appassets.androidplatform.net'].includes(u.hostname))
            return null;
        if (u.hostname === 'appassets.androidplatform.net' && u.pathname.startsWith('/assets/connect-web/'))
            return 'core/' + u.pathname.slice('/assets/connect-web/'.length);
        const m = u.pathname.match(/\/(?:storage\/v1\/object\/(?:sign|public|authenticated)|connect-web)\/(.+)$/);
        if (m)
            return decodeURIComponent(m[1]);
        if (u.origin === location.origin && /^\/(?:icon-|apple-touch|favicon|stickers\/|connect-crypto\/)/.test(u.pathname))
            return 'core' + u.pathname;
    }
    catch { }
    return null;
}
export function mediaCategory(key: string, type = ''): CacheCategory {
    if (key.startsWith('core') || key.startsWith('connect-avatars/'))
        return 'system';
    if (type.startsWith('video/') || /\.(mp4|webm|mov)(?:$|__)/i.test(key))
        return 'videos';
    if (type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(key))
        return 'audio';
    if (type.startsWith('image/') || /\.(png|webp|gif|jpe?g)$/i.test(key) || key.startsWith('connect-stickers/'))
        return 'photos';
    return 'other';
}
function db() { return opening ??= new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(NAME, 3); r.onupgradeneeded = () => { if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE, { keyPath: 'key' });
        if(!r.result.objectStoreNames.contains('links'))r.result.createObjectStore('links');
        if(!r.result.objectStoreNames.contains('retired'))r.result.createObjectStore('retired'); }; r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = undefined; }; resolve(r.result); }; r.onerror = () => { opening = undefined; reject(r.error); }; }); }
async function run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> { const d = await db(); return new Promise((resolve, reject) => { const t = d.transaction(STORE, mode), r = operation(t.objectStore(STORE)); let value: T; r.onsuccess = () => { value = r.result; }; t.oncomplete = () => resolve(value); t.onerror = () => reject(t.error || r.error); t.onabort = () => reject(t.error || Error('Cache transaction aborted')); }); }
async function entries() { return run<Entry[]>('readonly', s => s.getAll()); }
export function cacheLimit() { try {
    return (localStorage.getItem('connect-cache-limit') || 'auto') as keyof typeof LIMITS;
}
catch {
    return 'auto';
} }
export function setCacheLimit(value: string) { if (!(value in LIMITS))
    throw Error('Недопустимый лимит кеша'); localStorage.setItem('connect-cache-limit', value); void trimCache(); }
export async function cacheStats() { const result: Record<CacheCategory, number> = { system: 0, photos: 0, videos: 0, audio: 0, other: 0 }; for (const row of await entries())
    if (row.user === owner)
        result[row.category] += row.size; return result; }
export async function clearCachedMedia(category: CacheCategory | 'temporary', identity?: string) {
    const rows = await entries();
    for (const row of rows) {
        if (row.user !== owner || !identity && row.category === 'system')
            continue;
        if (identity ? row.key !== owner + ':' + identity : category !== 'temporary' && row.category !== category)
            continue;
        await run('readwrite', s => s.delete(row.key));
        const url = objectUrls.get(row.key);
        if (url) {
            restoreUrl(url);
            objectUrls.delete(row.key);
        }
    }
    window.dispatchEvent(new Event('connect:cache-changed'));
}
export async function trimCache() {
    const rows = (await entries()).filter(x => x.user === owner).sort((a, b) => a.used - b.used);
    let temporary = rows.filter(x => x.category !== 'system').reduce((n, x) => n + x.size, 0), avatars = rows.filter(x => x.category === 'system' && !x.key.includes(':core')).reduce((n, x) => n + x.size, 0);
    const limit = Math.max(0,(LIMITS[cacheLimit()] || LIMITS.auto)-await nativeHistoryBytes());
    for (const row of rows) {
        const avatar = row.category === 'system' && !row.key.includes(':core'), expired = Date.now() - row.used > 30 * 86400000;
        if (row.category === 'system' ? !avatar || avatars <= 64 * 1024 ** 2 : temporary <= limit && !expired)
            continue;
        await run('readwrite', s => s.delete(row.key));
        const local = objectUrls.get(row.key);
        if (local) { restoreUrl(local); objectUrls.delete(row.key); }
        if (avatar)
            avatars -= row.size;
        else
            temporary -= row.size;
    }
}
export async function resolveCachedMedia(url: string, user = owner): Promise<string> { const id = mediaIdentity(url); if (!id || !user || id.startsWith('core'))
    return url; const key = user + ':' + id; try {
    const row = await run<Entry | undefined>('readonly', s => s.get(key));
    if (!row)
        return url;
    const type = contentType(id, row.type || row.blob?.type);
    const blob = row.blob || (row.bytes instanceof ArrayBuffer ? new Blob([row.bytes], { type }) : undefined);
    if (!blob?.size || !usableType(type)) {
        await run('readwrite', s => s.delete(key));
        return url;
    }
    if (Date.now() - row.used > 60000) {
        row.used = Date.now();
        void run('readwrite', s => s.put(row)).catch(() => { });
    }
    let local = objectUrls.get(key);
    if (!local) {
        local = URL.createObjectURL(blob.type === type ? blob : blob.slice(0, blob.size, type));
        objectUrls.set(key, local);
    }
    originals.set(local, url);
    return local;
}
catch {
    return url;
} }
// Bound cache fills independently of the number of mounted messages. Visible
// interface/avatars precede small previews; originals enter only on playback.
let cacheWorkers=0;
const cacheJobs:{priority:number;run:()=>Promise<void>;resolve:()=>void}[]=[];
function cacheJob(priority:number,run:()=>Promise<void>){return new Promise<void>(resolve=>{cacheJobs.push({priority,run,resolve});cacheJobs.sort((a,b)=>a.priority-b.priority);pumpCacheJobs();});}
function pumpCacheJobs(){while(cacheWorkers<3&&cacheJobs.length){const job=cacheJobs.shift()!;cacheWorkers++;void job.run().catch(()=>{}).finally(()=>{cacheWorkers--;job.resolve();pumpCacheJobs();});}}
async function remember(url: string, user: string) { const id = mediaIdentity(url); if (!id || !user || id.startsWith('core'))
    return; const key = user + ':' + id; if (pending.has(key))
    return pending.get(key); const operation = cacheJob(mediaCategory(id)==='system'?0:/__(thumb\.webp|poster\.jpg)$/.test(id)?1:2,async () => { if (owner!==user || await run('readonly', s => s.get(key)))
    return; const response = await fetch(url, { cache: 'force-cache' }); if (!response.ok || response.status === 206)
    return; const length = Number(response.headers.get('content-length') || 0); if (length > 256 * 1024 ** 2)
    return; const blob = await response.blob(); if (!blob.size || blob.size > 256 * 1024 ** 2)
    return; const type = contentType(id, blob.type); if (!usableType(type)) return;
    // ArrayBuffer avoids WebKit's IndexedDB Blob-file staging failures. Old Blob
    // records remain readable; cache errors always leave the network URL usable.
    const bytes = await blob.arrayBuffer();
    const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction([STORE,'retired'],'readwrite');const check=tx.objectStore('retired').get(key);check.onsuccess=()=>{if(!check.result)tx.objectStore(STORE).put({key,user,category:mediaCategory(id,type),size:blob.size,used:Date.now(),bytes,type} satisfies Entry);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('Cache write aborted'));}); await trimCache(); }).catch(() => { }).finally(() => pending.delete(key)); pending.set(key, operation); return operation; }
export function installMediaCache(user: string, refreshUrl?: (source: string) => Promise<string | undefined>) {
    owner = user;
    let alive = true;
    const visible = new IntersectionObserver(items => { for (const item of items)
        if (item.isIntersecting) {
            const el = item.target as HTMLImageElement;
            if (el.complete && el.naturalWidth)
                void remember(originals.get(el.src) || el.currentSrc || el.src, user);
            visible.unobserve(el);
        } }, { rootMargin: '0px' });
    const scan = () => {
        for (const el of bindings.keys()) if (!el.isConnected) bindings.delete(el);
        document.querySelectorAll<MediaElement>('img[src],audio[src],video[src]').forEach(el => {
            const current = el.getAttribute('src') || '', source = originals.get(current) || current;
            if (!mediaIdentity(source) || bindings.get(el)?.current === current) return;
            const binding: Binding = { source, current, retried: false };
            bindings.set(el, binding);
            // Never change the source under an already playing audio/video.
            if (!(el instanceof HTMLMediaElement) || el.paused && !el.currentTime) {
                void resolveCachedMedia(source, user).then(local => {
                    if (alive && bindings.get(el) === binding && local !== current && el.getAttribute('src') === current) {
                        binding.current = local;
                        el.src = local;
                    }
                    if (alive && bindings.get(el) === binding && el instanceof HTMLImageElement && el.complete && !el.naturalWidth) {
                        el.dispatchEvent(new Event('error'));
                    }
                });
            }
            if (el instanceof HTMLImageElement) visible.observe(el);
        });
    };
    const failed = (event: Event) => {
        const el = event.target;
        if (!(el instanceof HTMLImageElement || el instanceof HTMLMediaElement)) return;
        const binding = bindings.get(el);
        if (!binding || binding.retried) return;
        binding.retried = true;
        void (async () => {
            const id = mediaIdentity(binding.source);
            if (!id) return;
            if (originals.has(el.src)) await clearCachedMedia('temporary', id).catch(() => {});
            const refreshed = await refreshUrl?.(binding.source).catch(() => undefined);
            if (!alive || bindings.get(el) !== binding || !el.isConnected) return;
            const source = refreshed || binding.source;
            // No retries for a failed, unchanged public URL. Storage links may
            // have expired; obtain a new signed URL using the current session.
            if (source !== el.src) {
                binding.source = source;
                binding.current = source;
                el.src = source;
                if (el instanceof HTMLMediaElement) el.load();
            }
        })();
    };
    const loaded = (event: Event) => { const el = event.target; if (el instanceof HTMLImageElement && el.getBoundingClientRect().bottom >= 0 && el.getBoundingClientRect().top <= innerHeight)
        void remember(originals.get(el.src) || el.currentSrc || el.src, user); if (el instanceof HTMLMediaElement && event.type === 'play')
        void remember(originals.get(el.src) || el.currentSrc || el.src, user); };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    document.addEventListener('load', loaded, true);
    document.addEventListener('play', loaded, true);
    document.addEventListener('error', failed, true);
    scan();
    void trimCache().catch(() => { });
    void navigator.storage?.persist?.().catch(() => { });
    return () => { alive = false; observer.disconnect(); visible.disconnect(); document.removeEventListener('load', loaded, true); document.removeEventListener('play', loaded, true); document.removeEventListener('error', failed, true); if (owner === user)
        owner = ''; for (const url of objectUrls.values())
        restoreUrl(url); objectUrls.clear(); bindings.clear(); };
}

/** Local content index contains only message IDs and stable storage identities. */
export async function linkMessageMedia(user:string,message:string,paths:string[]){
 if(!paths.length)return;const d=await db();await new Promise<void>((resolve,reject)=>{const tx=d.transaction(['links','retired'],'readwrite');const identities=[...new Set(paths.flatMap(path=>[path,path+'__thumb.webp',path+'__poster.jpg']))].map(path=>'connect-attachments/'+path);const guard=tx.objectStore('retired').get(user+':message:'+message);guard.onsuccess=()=>{if(guard.result)return;tx.objectStore('links').put(identities,user+':'+message);for(const identity of identities)tx.objectStore('retired').delete(user+':'+identity);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
export async function purgeDeletedMedia(user:string,message:string){
 if(owner!==user)return;const d=await db();const paths=await new Promise<string[]>((resolve,reject)=>{
  const tx=d.transaction(['links','retired'],'readwrite'),store=tx.objectStore('links'),keys=store.getAllKeys(),values=store.getAll();tx.objectStore('retired').put(true,user+':message:'+message);let deleted:string[]=[];
  values.onsuccess=()=>{const index=keys.result.findIndex(key=>key===user+':'+message);const current:string[]=index<0?[]:values.result[index];deleted=current.filter(path=>!values.result.some((other,i)=>i!==index&&String(keys.result[i]).startsWith(user+':')&&other.includes(path)));store.delete(user+':'+message);for(const path of deleted)tx.objectStore('retired').put(true,user+':'+path);};
  tx.oncomplete=()=>resolve(deleted);tx.onerror=()=>reject(tx.error);
 });for(const path of paths)await clearCachedMedia('temporary',path);
}

/** Background warmup of visible, lightweight chat previews; best effort. */
export async function prefetchCachedMedia(url:string,user:string):Promise<void>{
  const id=mediaIdentity(url);if(!url||!user||!id||mediaCategory(id)!=='system'&&!/__(thumb\.webp|poster\.jpg)$/.test(id))return;
  try{await remember(url,user);}catch{/* Network fallback remains usable. */}
}
