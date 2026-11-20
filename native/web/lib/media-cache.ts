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
    stream?:boolean;
    etag?:string;
    version?:string;
};
const NAME = 'connect-media-v1', STORE = 'objects';
let opening: Promise<IDBDatabase> | undefined;
let owner = '';
let mediaEpoch=0;
const controllers=new Map<string,AbortController>();
const versions=new Map<string,string>();
export function mediaCacheOwner(){return owner;}
export function mediaCacheEpoch(){return mediaEpoch;}
export function cacheLeaseValid(user:string,epoch:number){return owner===user&&mediaEpoch===epoch;}
let historyBudgetOwner='',historyBytes=0,historyBudgetAt=0,historyBudgetPending:Promise<void>|undefined;
async function nativeHistoryBytes(){
    if(!owner)return 0;
    if(historyBudgetOwner!==owner){historyBudgetOwner=owner;historyBytes=0;historyBudgetAt=0;historyBudgetPending=undefined;}
    if(Date.now()-historyBudgetAt>2500&&!historyBudgetPending){const user=owner;historyBudgetPending=chatHistoryStats(user).then(s=>{if(owner===user){historyBytes=s.bytes;historyBudgetAt=Date.now();}}).catch(()=>{if(owner===user)historyBudgetAt=Date.now();}).finally(()=>{if(owner===user)historyBudgetPending=undefined;});}
    await historyBudgetPending;return historyBytes;
}
const objectUrls = new Map<string, string>(), pending = new Map<string, Promise<void>>();
const originals = new Map<string, string>();
// Invalidate one deleted fill without disturbing unrelated downloads.
const fileEpochs=new Map<string,number>();
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
    // Keep the source identity for stale UI blob URLs until account teardown.
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
function db() { return opening ??= new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(NAME, 4); r.onupgradeneeded = () => { if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE, { keyPath: 'key' });
        if(!r.result.objectStoreNames.contains('links'))r.result.createObjectStore('links');
        if(!r.result.objectStoreNames.contains('retired'))r.result.createObjectStore('retired');if(!r.result.objectStoreNames.contains('media-ranges')){const ranges=r.result.createObjectStore('media-ranges',{keyPath:'key'});ranges.createIndex('file','file');ranges.createIndex('kind','kind');ranges.createIndex('fileStart',['file','start']);} }; r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = undefined; }; resolve(r.result); }; r.onerror = () => { opening = undefined; reject(r.error); }; }); }
async function run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> { const d = await db(); return new Promise((resolve, reject) => { const t = d.transaction(STORE, mode), r = operation(t.objectStore(STORE)); let value: T; r.onsuccess = () => { value = r.result; }; t.oncomplete = () => resolve(value); t.onerror = () => reject(t.error || r.error); t.onabort = () => reject(t.error || Error('Cache transaction aborted')); }); }
async function entries() { return run<Entry[]>('readonly', s => s.getAll()); }
export function cacheLimit() { try {
    return (localStorage.getItem('connect-cache-limit') || 'auto') as keyof typeof LIMITS;
}
catch {
    return 'auto';
} }
export function setCacheLimit(value: string) { if (!(value in LIMITS))
    throw Error('Недопустимый лимит кеша'); localStorage.setItem('connect-cache-limit', value);void updateResponseCacheLimit(); void trimCache(); }
export async function cacheStats() { const result: Record<CacheCategory, number> = { system: 0, photos: 0, videos: 0, audio: 0, other: 0 }; for (const row of await entries())
    if (row.user === owner)
        result[row.category] += row.size;return responseCacheStats(result); }
export async function clearCachedMedia(category: CacheCategory | 'temporary', identity?: string) {
    const viewer=owner;
    if(identity){const key=viewer+':'+identity;fileEpochs.set(key,(fileEpochs.get(key)||0)+1);controllers.get(key)?.abort();pending.delete(key);}
    else{mediaEpoch++;for(const controller of controllers.values())controller.abort();controllers.clear();pending.clear();}
    await clearResponseParts(category,identity,viewer);
    const rows = await entries();
    for (const row of rows) {
        if (row.user !== viewer || !identity && row.category === 'system')
            continue;
        if (identity ? row.key !== viewer + ':' + identity : category !== 'temporary' && row.category !== category)
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
        // CONNECT_ANDROID_STICKERS_PINNED_20261117: app-private IndexedDB is durable device storage.
        // Signed URLs expire, but a stored image must not be evicted on a timer.
        if (row.key.startsWith(owner + ':connect-stickers/')) continue;
        const avatar = row.category === 'system' && !row.key.includes(':core'), expired = Boolean((window as Window & {ConnectAndroid?:unknown;ConnectNative?:unknown}).ConnectAndroid||(window as Window & {ConnectAndroid?:unknown;ConnectNative?:unknown}).ConnectNative) && Date.now() - row.used > 30 * 86400000;
        if (row.category === 'system' ? !avatar || avatars <= 64 * 1024 ** 2 : temporary <= limit && !expired)
            continue;
        await clearResponseParts('temporary',row.key.slice(owner.length+1),owner);
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
    return url; const key = user + ':' + id,epoch=mediaEpoch,fileEpoch=fileEpochs.get(key)||0; const validFile=()=>cacheLeaseValid(user,epoch)&&(fileEpochs.get(key)||0)===fileEpoch; if(owner!==user)return url;try {
    if(mediaTransport==='native'){const local=await responseCacheLookup(url,user);if(local&&validFile())return local;}
    const row = await run<Entry | undefined>('readonly', s => s.get(key));
    if(!validFile())return url;
    if(!row||versions.has(key)&&row.version!==versions.get(key)){const native=await responseCacheLookup(url,user);return validFile()&&native?native:url;}
    if(row.stream){
      const hot=objectUrls.get(key);if(hot&&validFile())return hot;
      if(row.size<=2*1024*1024){const blob=await readStreamedBlob(row,url,user,epoch);if(!blob||!validFile())return url;let local=objectUrls.get(key);if(!local){local=URL.createObjectURL(blob);objectUrls.set(key,local);}originals.set(local,url);return local;}
      await mediaReady;if(!validFile()||!mediaBound)return url;const local=new URL('/supabase/storage/v1/object/authenticated/'+id,location.origin);local.searchParams.set('__cm',mediaNonce);local.searchParams.set('__cm_local','1');return local.href;
    }
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
    const local=await responseCacheLookup(url,user).catch(()=>null);return validFile()&&local?local:url;
} }
// Bound cache fills independently of the number of mounted messages. Visible
// interface/avatars precede small previews; originals enter only on playback.
let cacheWorkers=0;
const cacheJobs:{priority:number;run:()=>Promise<void>;resolve:()=>void}[]=[];
function cacheJob(priority:number,run:()=>Promise<void>){return new Promise<void>(resolve=>{cacheJobs.push({priority,run,resolve});cacheJobs.sort((a,b)=>a.priority-b.priority);pumpCacheJobs();});}
function pumpCacheJobs(){while(cacheWorkers<3&&cacheJobs.length){const job=cacheJobs.shift()!;cacheWorkers++;void job.run().catch(()=>{}).finally(()=>{cacheWorkers--;job.resolve();pumpCacheJobs();});}}
export async function boundedMediaBody(response:Response,maxBytes:number):Promise<Blob|null>{
 if(!Number.isFinite(maxBytes)||maxBytes<=0){await response.body?.cancel();return null;}
 const length=Number(response.headers.get('content-length')||0);
 if(length>maxBytes){await response.body?.cancel();return null;}
 // Streaming cap also covers absent or misleading Content-Length.
 if(!response.body)return null;
 const reader=response.body.getReader(),parts:Uint8Array<ArrayBuffer>[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();return null;}parts.push(new Uint8Array(value));}}
 finally{reader.releaseLock();}
 return size?new Blob(parts,{type:response.headers.get('content-type')||''}):null;
}
async function remember(url:string,user:string,maxBytes=0,signal?:AbortSignal){
 const id=mediaIdentity(url);if(!Number.isFinite(maxBytes)||maxBytes<=0||!id||!user||id.startsWith('core')||owner!==user||signal?.aborted)return;
 const key=user+':'+id,epoch=mediaEpoch,fileEpoch=fileEpochs.get(user+':'+id)||0,version=versions.get(key);if(pending.has(key))return pending.get(key);
 const operation=cacheJob(mediaCategory(id)==='system'?0:/__(thumb\.webp|poster\.jpg)$/.test(id)?1:2,async()=>{
   if(!cacheLeaseValid(user,epoch)||signal?.aborted)return;
   const old=await run<Entry|undefined>('readonly',s=>s.get(key));
   if(old&&(!versions.has(key)||old.version===version))return;
   if(!cacheLeaseValid(user,epoch)||(fileEpochs.get(key)||0)!==fileEpoch)return;
   if(old){const stale=objectUrls.get(key);if(stale){restoreUrl(stale);objectUrls.delete(key);}}
   const controller=new AbortController(),abort=()=>controller.abort();controllers.set(key,controller);signal?.addEventListener('abort',abort,{once:true});
   try{
    const response=await fetch(url,{cache:'force-cache',signal:controller.signal});if(!response.ok||response.status===206){await response.body?.cancel();return;}
    const blob=await boundedMediaBody(response,maxBytes);if(!blob||!cacheLeaseValid(user,epoch)||(fileEpochs.get(key)||0)!==fileEpoch||versions.get(key)!==version)return;
    if(mediaTransport==='worker'||mediaTransport==='native')return;
    const type=contentType(id,blob.type);if(!usableType(type))return;const bytes=await blob.arrayBuffer();
    const database=await db();await new Promise<void>((resolve,reject)=>{
      const tx=database.transaction([STORE,'retired'],'readwrite');const check=tx.objectStore('retired').get(key);
      check.onsuccess=()=>{if(!check.result&&cacheLeaseValid(user,epoch)&&(fileEpochs.get(key)||0)===fileEpoch&&versions.get(key)===version)tx.objectStore(STORE).put({key,user,category:mediaCategory(id,type),size:blob.size,used:Date.now(),bytes,type,version} satisfies Entry);};
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Cache write aborted'));
    });await trimCache();
   }finally{signal?.removeEventListener('abort',abort);if(controllers.get(key)===controller)controllers.delete(key);}
 }).catch(()=>{}).finally(()=>{if(pending.get(key)===operation)pending.delete(key);});
 pending.set(key,operation);return operation;
}
/** Rendered images may fill only small sidecars, avatars and stickers. */
function automaticImageByteLimit(id:string):number{
 if(/__(thumb\.webp|poster\.jpg)$/.test(id))return 512*1024;
 if(id.startsWith('connect-avatars/'))return 1024*1024;
 if(id.startsWith('connect-stickers/'))return 2*1024*1024;
 return 0;
}
function rememberRenderedImage(_el:HTMLImageElement,_user:string){/* The first response is captured by the request transport; no second GET. */}
export function installMediaCache(user: string, refreshUrl?: (source: string) => Promise<string | undefined>) {
    mediaEpoch++;owner = user;window.dispatchEvent(new Event('connect:account-changed'));
    installMediaFetchGate();const stopResponseCache=beginResponseCache(user);
    let alive = true;
    const visible = new IntersectionObserver(items => { for (const item of items)
        if (item.isIntersecting) {
            const el = item.target as HTMLImageElement;
            if (el.complete && el.naturalWidth)
                rememberRenderedImage(el,user);
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
                    // CONNECT_PWA_MEDIA_CACHE_NATIVE_IMAGE_ERRORS_FIX3_20261115
                    // A new blob: src may be complete with zero naturalWidth while
                    // decode is pending. Wait for the browser's native error event;
                    // synthesizing one here evicts a valid persistent cache entry.
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
        const failedSrc = el.getAttribute('src') || '';
        if (failedSrc !== binding.current) return;
        binding.retried = true;
        void (async () => {
            // CONNECT_MEDIA_STALE_IMAGE_ERROR_GUARD_20261117
            // An old request can dispatch `error` after a healthy cached blob
            // becomes current. Only evict when the CURRENT image fails decode.
            if (el instanceof HTMLImageElement && (originals.has(failedSrc)||isCachedMediaUrl(failedSrc))) {
                try {
                    await el.decode();
                    if (alive && bindings.get(el) === binding && el.getAttribute('src') === failedSrc) {
                        binding.retried = false;
                        return;
                    }
                } catch { /* Decode really failed; follow existing repair path. */ }
            }
            if (!alive || bindings.get(el) !== binding || el.getAttribute('src') !== failedSrc) {
                binding.retried = false;
                return;
            }
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
    // CONNECT_PWA_MEDIA_EGRESS_FIX_20261115
    // Audio/video can use HTTP Range requests while playing. A parallel fetch()
    // on every play event doubles network egress, particularly for videos.
    // Keep image caching and bounded, explicit audio/thumbnail prefetch only.
    const loaded = (event: Event) => {
        const el = event.target;
        if (el instanceof HTMLImageElement && el.getBoundingClientRect().bottom >= 0 && el.getBoundingClientRect().top <= innerHeight)
            rememberRenderedImage(el,user);
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    document.addEventListener('load', loaded, true);
    document.addEventListener('error', failed, true);
    scan();
    void trimCache().catch(() => { });
    void navigator.storage?.persist?.().catch(() => { });
    return () => { stopResponseCache();alive = false; observer.disconnect(); visible.disconnect(); document.removeEventListener('load', loaded, true); document.removeEventListener('play', loaded, true); document.removeEventListener('error', failed, true); if (owner === user){owner = '';mediaEpoch++;responseMediaVersions.clear();signedMediaIssued.clear();window.dispatchEvent(new Event('connect:account-changed'));for(const c of controllers.values())c.abort();controllers.clear();pending.clear();fileEpochs.clear();versions.clear();} for (const url of objectUrls.values())
        restoreUrl(url); objectUrls.clear(); bindings.clear(); originals.clear(); };
}

/** Local content index contains only message IDs and stable storage identities. */
export async function linkMessageMedia(user:string,message:string,paths:string[]){
 if(owner!==user||!paths.length)return;const epoch=mediaEpoch,d=await db(),revived:string[]=[];
 await new Promise<void>((resolve,reject)=>{const tx=d.transaction(['links','retired'],'readwrite'),retired=tx.objectStore('retired');const identities=[...new Set(paths.flatMap(path=>[path,path+'__thumb.webp',path+'__poster.jpg']))].map(path=>'connect-attachments/'+path);const guard=retired.get(user+':message:'+message);
 guard.onsuccess=()=>{if(guard.result||!cacheLeaseValid(user,epoch))return;tx.objectStore('links').put(identities,user+':'+message);for(const identity of identities){const q=retired.get(user+':'+identity);q.onsuccess=()=>{if(q.result)revived.push(identity);retired.delete(user+':'+identity);};}};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});
 if(revived.length){await mediaReady;if(mediaTransport==='native'&&cacheLeaseValid(user,epoch))for(const identity of revived)await nativeMedia('revive',{identity},user);}
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
 const id=mediaIdentity(url),maxBytes=id?automaticImageByteLimit(id):0;
 if(!url||!user||!maxBytes)return;
 await remember(url,user,maxBytes);
}

/** Profile bytes reuse this same objects store, keyed by path, never signed URL. */
function profileIdentity(path:string){return 'connect-profile-media/'+path;}
export async function resolveCachedProfileFile(user:string,path:string,version?:string):Promise<string|null>{
 if(owner!==user||!path||path.includes('?')||path.includes('://'))return null;
 const identity=profileIdentity(path),key=user+':'+identity;
 if(version){await noteMediaVersion(user,identity,version);versions.set(key,version);}
 const source=location.origin+'/storage/v1/object/authenticated/'+identity.split('/').map(encodeURIComponent).join('/');
 const resolved=await resolveCachedMedia(source,user);return resolved===source?null:resolved;
}
export async function prefetchProfileFile(url:string,user:string,kind:string,maxBytes:number,epoch=mediaEpoch,signal?:AbortSignal):Promise<void>{
 // Image sidecars use prefetchCachedMedia; photo/video originals stay on demand.
 const id=mediaIdentity(url);if(kind!=='music'||!id?.startsWith('connect-profile-media/')||mediaCategory(id)!=='audio'||!cacheLeaseValid(user,epoch))return;
 await remember(url,user,maxBytes,signal);
}
export async function purgeCachedProfileFile(user:string,path:string,permanent=false):Promise<void>{
 if(owner!==user)return;const key=user+':'+profileIdentity(path),database=await db();versions.set(key,'revoked:'+Date.now());
 await new Promise<void>((resolve,reject)=>{const tx=database.transaction([STORE,'retired'],'readwrite');if(permanent)tx.objectStore('retired').put(true,key);tx.objectStore(STORE).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
 await clearCachedMedia('temporary',profileIdentity(path));
 const local=objectUrls.get(key);if(local){URL.revokeObjectURL(local);originals.delete(local);objectUrls.delete(key);}
 window.dispatchEvent(new CustomEvent('connect:profile-media-retired',{detail:{user,path}}));
}

export async function resolveCachedStorageFile(user:string,bucket:string,path:string):Promise<string|null>{
 const source=location.origin+'/storage/v1/object/authenticated/'+[bucket,...path.split('/')].map(encodeURIComponent).join('/');
 const result=await resolveCachedMedia(source,user);return result===source?null:result;
}

export const retireCachedProfileFile=(user:string,path:string)=>purgeCachedProfileFile(user,path,true);

/** Preserve the existing Android/DuckDNS media proxy for renewed player URLs. */
export function mediaPlaybackUrl(url:string):string{
 const result=cacheMediaUrl(url);if(!signedMediaIssued.has(result))signedMediaIssued.set(result,Date.now());if(signedMediaIssued.size>2048)signedMediaIssued.delete(signedMediaIssued.keys().next().value!);return result;
 /* Legacy proxy retained below for source compatibility. */
 if(location.hostname!=='connect-chat.duckdns.org')return url;
 const root=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
 try{const source=new URL(url),base=new URL(root);
  if(source.hostname===base.hostname)return location.origin+'/supabase'+source.pathname+source.search+source.hash;
  if(source.hostname===base.hostname.replace(/\.supabase\.co$/,'.storage.supabase.co'))return location.origin+'/supabase-storage'+source.pathname+source.search+source.hash;
 }catch{}
 return url;
}


/** Save a generated video-note first frame to the existing account-scoped media cache.
 * Only a JPEG image is written. This never persists an extra video decoder.
 */
export async function storeGeneratedChatPoster(viewer:string,path:string,image:Blob):Promise<string|null>{
  if(!viewer||owner!==viewer||!path||image.type!=='image/jpeg'||!image.size||image.size>512*1024)return null;
  const identity='connect-attachments/'+path+'__poster.jpg',key=viewer+':'+identity;
  try{
    const bytes=await image.arrayBuffer();
    const database=await db();
    await new Promise<void>((resolve,reject)=>{
      const tx=database.transaction([STORE,'retired'],'readwrite');
      const guard=tx.objectStore('retired').get(key);
      guard.onsuccess=()=>{if(!guard.result)tx.objectStore(STORE).put({key,user:viewer,category:'photos',size:image.size,used:Date.now(),bytes,type:'image/jpeg'} satisfies Entry);};
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    return await resolveCachedMedia('/storage/v1/object/sign/'+identity,viewer);
  }catch{return null;}
}

/** CONNECT_PWA_CHAT_STICKER_CACHE_V1_20261115
 * Cache WebP by its stable authenticated Storage path, not signed URL tokens.
 */
export async function prefetchStickerWebp(url:string,user:string):Promise<void>{
  const id=mediaIdentity(url);
  if(!url||!user||!id?.startsWith('connect-stickers/'))return;
  await remember(url,user,2*1024*1024);
}

/** CONNECT_PWA_CHAT_AUDIO_LAZY_CACHE_V1_20261115
 * Warm a couple of small voice messages without blocking chat rendering.
 * Persist by stable storage path, not by expiring signed URL.
 */
export async function prefetchChatAudio(url:string,user:string,declaredSize:number):Promise<void>{
  const id=mediaIdentity(url);
  if(!url||!user||!id?.startsWith('connect-attachments/')||!declaredSize||declaredSize>1024*1024)return;
  await remember(url,user,1024*1024);
}

/** In-memory signatures only; durable bytes remain in the existing account/path cache. */
type IO={
 lease:(user:string)=>number|null;
 cached:(user:string,bucket:string,path:string)=>Promise<string|null>;
 sign:(user:string,bucket:string,path:string)=>Promise<string|undefined>;
 now?:()=>number;
};
export function createSignedMediaCache(io:IO){
 const now=io.now||Date.now;
 const links=new Map<string,{url:string;expires:number;lease:number}>();
 const pending=new Map<string,Promise<string|undefined>>();
 async function resolve(user:string,bucket:string,path:string,force=false):Promise<string|undefined>{
  const lease=io.lease(user);if(lease===null||!user||!path)return;
  const valid=()=>io.lease(user)===lease;
  // Local bytes are independent of token expiry; never sign merely to read them.
  if(!force){const local=await io.cached(user,bucket,path);if(!valid())return;if(local)return local;}
  const key=user+':'+bucket+'/'+path;
  if(force)links.delete(key);
  const old=links.get(key);
  if(!force&&old?.lease===lease&&old.expires>now()+60000)return old.url;
  const operationKey=key+':'+lease,existing=pending.get(operationKey);if(existing)return existing;
  const started=now();
  const task=(async()=>{
   const url=await io.sign(user,bucket,path);
   if(!url||!valid()||started+3600000<=now()+60000)return;
   links.set(key,{url,expires:started+3600000,lease});
   if(links.size>1024)links.delete(links.keys().next().value!);
   return url;
  })().finally(()=>{if(pending.get(operationKey)===task)pending.delete(operationKey);});
  pending.set(operationKey,task);return task;
 }
 return {resolve,clear:(user:string)=>{for(const key of links.keys())if(key.startsWith(user+':'))links.delete(key);}};
}


// CONNECT_MEDIA_RESPONSE_CACHE_V1 — per-login request scope, not a cache key.
type MediaCacheTransport='pending'|'worker'|'native'|'legacy';
let mediaTransport:MediaCacheTransport='legacy',mediaNonce='',mediaBound=false;
let mediaReady:Promise<boolean>=Promise.resolve(false),mediaBarrier:Promise<unknown>=Promise.resolve();
let firstMediaOwner:(()=>void)|undefined,hasMediaOwner=false;
const firstMediaOwnerReady=new Promise<void>(resolve=>{firstMediaOwner=resolve;});
const mediaEpochKeys=(user:string,file:string)=>['@cm-owner:'+user,'@cm-file:'+file,...(['system','photos','videos','audio','other'] as const).map(k=>'@cm-kind:'+user+':'+k),'@cm-version:'+file,file];
const nativeMediaBridge=()=>typeof window==='undefined'?undefined:(window as unknown as {ConnectNative?:{request:(name:string,value:unknown)=>Promise<any>}}).ConnectNative;
export function whenMediaCacheReady(){return mediaReady;}
export function isCachedMediaUrl(source:string){if(source.startsWith('blob:'))return true;try{const u=new URL(source,location.href);return !!owner&&u.origin===location.origin&&u.searchParams.get('__cm_local')==='1'&&u.searchParams.get('__cm')===mediaNonce;}catch{return false;}}
function mediaBaseUrl(source:string){try{const u=new URL(source,location.href);if(!mediaIdentity(u.href)||mediaIdentity(u.href)!.startsWith('core'))return source;if(u.origin!==location.origin){const proxy=u.hostname.endsWith('.storage.supabase.co')?'/supabase-storage':'/supabase';return location.origin+proxy+u.pathname+u.search;}return u.href;}catch{return source;}}
export function cacheMediaUrl(source:string){const raw=mediaBaseUrl(source);try{const u=new URL(raw,location.href);if(!mediaIdentity(u.href)||mediaIdentity(u.href)!.startsWith('core'))return raw;const old=u.searchParams.get('__cm');if(old&&old!==mediaNonce)return '';if(mediaBound&&owner)u.searchParams.set('__cm',mediaNonce);else{u.searchParams.delete('__cm');u.searchParams.delete('__cm_local');}return u.href;}catch{return raw;}}
async function mediaRPC(worker:ServiceWorker,value:unknown,timeout=3000):Promise<any>{return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('Media cache worker unavailable'));},timeout);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};worker.postMessage(value,[channel.port2]);});}
async function nativeMedia(action:string,payload:Record<string,unknown>={},user=owner,nonce=mediaNonce):Promise<any>{const bridge=nativeMediaBridge();if(!bridge)return;const reply=await bridge.request('media:cache',{action,userId:user,nonce,...payload});return reply?.supported?reply.value:undefined;}
async function bindMediaWorker(user:string,nonce:string):Promise<boolean>{
 if(!('serviceWorker' in navigator))return false;
 const value={type:'CONNECT_MEDIA_BIND',protocol:1,user,nonce,limit:LIMITS[cacheLimit()]||LIMITS.auto};
 const current=()=>owner===user&&mediaNonce===nonce;
 const active=navigator.serviceWorker.controller;
 if(active){try{const reply=await mediaRPC(active,value,300);if(reply?.protocol===1&&reply.supported&&current())return true;}catch{/* Upgrade a pre-cache worker without delaying already cached blobs. */}}
 const installed=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
 const updating=installed.installing||installed.waiting;if(updating&&updating.state!=='activated')await new Promise<void>((resolve,reject)=>{const done=()=>{if(updating.state==='activated'){clearTimeout(timer);updating.removeEventListener('statechange',done);resolve();}else if(updating.state==='redundant'){clearTimeout(timer);updating.removeEventListener('statechange',done);reject(Error('Media worker upgrade failed'));}};const timer=setTimeout(()=>{updating.removeEventListener('statechange',done);reject(Error('Media worker upgrade timed out'));},8000);updating.addEventListener('statechange',done);done();});
 const registration=await navigator.serviceWorker.ready;
 if(!navigator.serviceWorker.controller){await mediaRPC(registration.active!,value);await new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();};const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',done);reject(Error('Media worker is not controlling this document'));},5000);navigator.serviceWorker.addEventListener('controllerchange',done);if(navigator.serviceWorker.controller)done();});}
 const reply=await mediaRPC(navigator.serviceWorker.controller!,value);return reply?.protocol===1&&reply.supported&&current();
}
function beginResponseCache(user:string){
 const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');mediaNonce=nonce;mediaBound=false;mediaTransport='pending';hasMediaOwner=true;firstMediaOwner?.();firstMediaOwner=undefined;
 mediaReady=(async()=>{await mediaBarrier;if(owner!==user||mediaNonce!==nonce)return false;
  if(nativeMediaBridge()){const reply=await nativeMedia('bind',{limitBytes:LIMITS[cacheLimit()]||LIMITS.auto},user,nonce);if(owner!==user||mediaNonce!==nonce)return false;mediaBound=reply===true;mediaTransport=mediaBound?'native':'legacy';}
  else{mediaBound=await bindMediaWorker(user,nonce);mediaTransport=mediaBound?'worker':'legacy';}
  return mediaBound;
 })().catch(()=>{if(owner===user&&mediaNonce===nonce){mediaBound=false;mediaTransport='legacy';window.dispatchEvent(new CustomEvent('connect:media-cache-capability',{detail:{available:false}}));}return false;});
 if('serviceWorker' in navigator&&!nativeMediaBridge()){
  const message=(event:MessageEvent)=>{if(event.data?.type==='CONNECT_MEDIA_SCOPE_REQUEST'&&owner===user&&mediaNonce===nonce)event.ports?.[0]?.postMessage({user,nonce,limit:LIMITS[cacheLimit()]||LIMITS.auto});if(event.data?.type==='CONNECT_MEDIA_FILLED'&&event.data.user===owner)window.dispatchEvent(new CustomEvent('connect:media-cache-filled',{detail:event.data}));};
  const changed=()=>{if(owner===user&&mediaNonce===nonce){mediaReady=bindMediaWorker(user,nonce).then(ok=>{mediaBound=ok;mediaTransport=ok?'worker':'legacy';return ok;}).catch(()=>false);}};
  navigator.serviceWorker.addEventListener('message',message);navigator.serviceWorker.addEventListener('controllerchange',changed);
  return()=>{navigator.serviceWorker.removeEventListener('message',message);navigator.serviceWorker.removeEventListener('controllerchange',changed);navigator.serviceWorker.controller?.postMessage({type:'CONNECT_MEDIA_UNBIND',nonce});endResponseCache(user,nonce);};
 }
 return()=>{void nativeMedia('unbind',{},user,nonce).catch(()=>{});endResponseCache(user,nonce);};
}
function endResponseCache(user:string,nonce:string){if(mediaNonce===nonce){mediaBound=false;mediaTransport='legacy';mediaNonce='';}mediaBarrier=mediaBarrier.catch(()=>{}).then(async()=>{const d=await db();await new Promise<void>((resolve,reject)=>{const tx=d.transaction('retired','readwrite'),store=tx.objectStore('retired');const q=store.get('@cm-owner:'+user);q.onsuccess=()=>store.put(Number(q.result||0)+1,'@cm-owner:'+user);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});}).catch(()=>{});}
function installMediaSourceGate(){
 if(typeof window==='undefined')return;
 const record=new WeakMap<Element,Map<string,{source:string;promise:Promise<void>}>>();
 const setAttribute=Element.prototype.setAttribute,removeAttribute=Element.prototype.removeAttribute;
 const isMedia=(el:Element,name:string)=>name==='src'&&['IMG','AUDIO','VIDEO','SOURCE'].includes(el.tagName)||name==='poster'&&el.tagName==='VIDEO';
 function assign(el:Element,name:string,source:string,write:(value:string)=>void){
  const old=record.get(el);old?.delete(name);
  if(!isMedia(el,name)||source.startsWith('blob:')||source.startsWith('data:')){write(source);return;}const id=mediaIdentity(source);if(!id||id.startsWith('core')){write(source);return;}
  if(!owner&&hasMediaOwner){write('');return;}
  const requestedOwner=owner,requestedNonce=mediaNonce;const entries=old||new Map();record.set(el,entries);
  const item={source,promise:Promise.resolve()};entries.set(name,item);
  item.promise=(async()=>{if(!requestedOwner)await firstMediaOwnerReady;const user=requestedOwner||owner,nonce=requestedNonce||mediaNonce;await mediaReady;if(entries.get(name)!==item||owner!==user||mediaNonce!==nonce||!user)return;const local=await resolveCachedMedia(source,user);if(entries.get(name)!==item||owner!==user||mediaNonce!==nonce)return;entries.delete(name);write(cacheMediaUrl(local));})();
 }
 Element.prototype.setAttribute=function(name,value){const key=name.toLowerCase();assign(this,key,String(value),next=>setAttribute.call(this,name,next));};
 Element.prototype.removeAttribute=function(name){record.get(this)?.delete(name.toLowerCase());removeAttribute.call(this,name);};
 for(const [prototype,name]of [[HTMLImageElement.prototype,'src'],[HTMLMediaElement.prototype,'src'],[HTMLSourceElement.prototype,'src'],[HTMLVideoElement.prototype,'poster']] as const){const descriptor=Object.getOwnPropertyDescriptor(prototype,name);if(!descriptor?.set)continue;Object.defineProperty(prototype,name,{...descriptor,set(this:Element,value:string){assign(this,name,String(value),next=>descriptor.set!.call(this,next));}});}
 const decode=HTMLImageElement.prototype.decode;if(decode)HTMLImageElement.prototype.decode=function(){const waiting=record.get(this)?.get('src');return waiting?waiting.promise.then(()=>decode.call(this)):decode.call(this);};
 const play=HTMLMediaElement.prototype.play,load=HTMLMediaElement.prototype.load;HTMLMediaElement.prototype.play=function(){const pending=record.get(this)?.get('src');return pending?pending.promise.then(()=>play.call(this)):play.call(this);};HTMLMediaElement.prototype.load=function(){const pending=record.get(this)?.get('src');if(pending){void pending.promise.then(()=>{if(!record.get(this)?.get('src'))load.call(this);});}else load.call(this);};
}
let mediaFetchInstalled=false;
function installMediaFetchGate(){if(mediaFetchInstalled)return;mediaFetchInstalled=true;const original=window.fetch.bind(window);
 window.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url,method=init?.method||(input instanceof Request?input.method:'GET'),id=mediaIdentity(raw);if(method.toUpperCase()!=='GET'||!id||id.startsWith('core'))return original(input,init);const request=new Request(input,init);const user=owner,epoch=mediaEpoch,nonce=mediaNonce;if(!user)throw new DOMException('Media account signed out','AbortError');await mediaReady;if(!cacheLeaseValid(user,epoch)||nonce!==mediaNonce)throw new DOMException('Media account changed','AbortError');const source=cacheMediaUrl(request.url);if(!source)throw new DOMException('Stale media scope','AbortError');return original(new Request(source,request));}) as typeof fetch;
}
async function readStreamedBlob(row:Entry,url:string,user:string,epoch:number):Promise<Blob|null>{
 const d=await db();const key=row.key;const meta=await new Promise<any>((resolve,reject)=>{const q=d.transaction('media-ranges').objectStore('media-ranges').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});if(!meta?.complete||meta.total!==row.size)return null;
 const pieces:ArrayBuffer[]=[];let offset=0;
 while(offset<row.size){const part=await new Promise<any>((resolve,reject)=>{const q=d.transaction('media-ranges').objectStore('media-ranges').index('fileStart').openCursor(IDBKeyRange.bound([key,0],[key,offset]),'prev');q.onsuccess=()=>resolve(q.result?.value);q.onerror=()=>reject(q.error);});if(!part||part.end<offset||!cacheLeaseValid(user,epoch))return null;const size=Math.min(row.size-offset,part.end-offset+1);pieces.push(part.bytes.slice(offset-part.start,offset-part.start+size));offset+=size;}
 return new Blob(pieces,{type:row.type||contentType(mediaIdentity(url)||'')});
}
async function responseCacheLookup(url:string,user:string):Promise<string|null>{
 if(user!==owner)return null;await mediaReady;if(mediaTransport!=='native'||user!==owner)return null;const id=mediaIdentity(url);if(!id)return null;const value=await nativeMedia('lookup',{identity:id,version:versionsForMedia().get(user+':'+id)||''});return value?.complete&&typeof value.url==='string'?value.url:null;
}
// Each platform retains its existing cache entry schema; versions are shared locally.
const responseMediaVersions=new Map<string,string>();
function versionsForMedia(){return responseMediaVersions;}
export async function noteMediaVersion(user:string,identity:string,version:string){
 if(!version||user!==owner)return;const key=user+':'+identity,previous=responseMediaVersions.get(key);responseMediaVersions.set(key,version);const d=await db();let invalidate=false;
 await new Promise<void>((resolve,reject)=>{const tx=d.transaction(['retired','objects'],'readwrite'),store=tx.objectStore('retired'),request=store.get('@cm-version:'+key);request.onsuccess=()=>{invalidate=Boolean(request.result&&request.result!==version||previous&&previous!==version);store.put(version,'@cm-version:'+key);};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});
 if(invalidate)await clearCachedMedia('temporary',identity);if(mediaTransport==='native')await nativeMedia('lookup',{identity,version});
}
async function clearResponseParts(category:CacheCategory|'temporary',identity:string|undefined,viewer:string){
 const d=await db();const metas=await new Promise<any[]>((resolve,reject)=>{const q=d.transaction('media-ranges').objectStore('media-ranges').index('kind').getAll('meta');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 const affected=metas.filter(m=>m.user===viewer&&(identity?m.id===identity:category==='temporary'?m.category!=='system':m.category===category));
 await new Promise<void>((resolve,reject)=>{const tx=d.transaction(['retired','media-ranges'],'readwrite'),retired=tx.objectStore('retired'),parts=tx.objectStore('media-ranges');const bump=(key:string)=>{const q=retired.get(key);q.onsuccess=()=>retired.put(Number(q.result||0)+1,key);};if(identity)bump('@cm-file:'+viewer+':'+identity);else for(const kind of category==='temporary'?['photos','videos','audio','other']:[category])bump('@cm-kind:'+viewer+':'+kind);
  for(const meta of affected){const q=parts.index('file').openKeyCursor(IDBKeyRange.only(meta.file));q.onsuccess=()=>{const cursor=q.result;if(cursor){parts.delete(cursor.primaryKey);cursor.continue();}};}tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);
 });
 if(mediaTransport==='native'&&viewer===owner){let retire=false;if(identity)retire=await new Promise<boolean>((resolve,reject)=>{const q=d.transaction('retired').objectStore('retired').get(viewer+':'+identity);q.onsuccess=()=>resolve(Boolean(q.result));q.onerror=()=>reject(q.error);});await nativeMedia('clear',{category,...(identity?{identity,retire}: {})});}
}
installMediaSourceGate();

const signedMediaIssued=new Map<string,number>();
export function signedMediaUrlValid(url:string):boolean{
 if(!url)return false;if(isCachedMediaUrl(url))return true;
 try{const token=new URL(url,location.href).searchParams.get('token');if(token){const raw=token.split('.')[1];if(raw){const data=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/')));if(Number.isFinite(data.exp))return Date.now()<data.exp*1000-45000;}}}catch{}
 const at=signedMediaIssued.get(url);return at!==undefined&&Date.now()<at+3555000;
}

async function updateResponseCacheLimit(){try{await mediaReady;if(!owner||!mediaBound)return;const limit=LIMITS[cacheLimit()]||LIMITS.auto;if(mediaTransport==='native')await nativeMedia('bind',{limitBytes:limit});else if(navigator.serviceWorker.controller)await mediaRPC(navigator.serviceWorker.controller,{type:'CONNECT_MEDIA_BIND',protocol:1,user:owner,nonce:mediaNonce,limit});}catch{/* Cache settings never invalidate authentication. */}}
async function responseCacheStats(result:Record<CacheCategory,number>){const user=owner;try{const d=await db();const partial=await new Promise<any[]>((resolve,reject)=>{const q=d.transaction('media-ranges').objectStore('media-ranges').index('kind').getAll('meta');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});for(const m of partial)if(m.user===user&&!m.complete)result[m.category as CacheCategory]+=Number(m.stored)||0;if(mediaTransport==='native'){const native=await nativeMedia('stats');if(user===owner&&native)for(const kind of ['system','photos','videos','audio','other'] as const)result[kind]+=Number(native[kind])||0;}}catch{/* Browser/private storage may be unavailable. */}return user===owner?result:{system:0,photos:0,videos:0,audio:0,other:0};}
