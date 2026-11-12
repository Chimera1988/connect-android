/** Android adaptation: encrypted SQLite metadata + the existing media byte cache. */
import type {SupabaseClient} from '@supabase/supabase-js';
import {readNativeCatalog,writeNativeCatalog} from './native-catalog';
import {prefetchProfileFile,retireCachedProfileFile,purgeCachedProfileFile,resolveCachedProfileFile,mediaCacheOwner,mediaCacheEpoch,cacheLeaseValid} from './media-cache';
export type ProfileLibraryKind='photos'|'videos'|'music';
export type ProfileLibraryRow={path:string;createdAt:string;version?:string;size?:number};
const kinds:ProfileLibraryKind[]=['photos','videos','music'];
const key=(owner:string,kind:ProfileLibraryKind)=>'profile:'+owner+':'+kind;
const safe=(owner:string,kind:ProfileLibraryKind,x:ProfileLibraryRow)=>typeof x?.path==='string'&&x.path.startsWith(owner+'/'+kind+'/')&&!/[?\\]|\.\.|:\/\//.test(x.path)&&typeof x.createdAt==='string';
export async function readProfileLibrary(viewer:string,owner:string,kind:ProfileLibraryKind):Promise<ProfileLibraryRow[]|null>{
 const row=await readNativeCatalog<{items:ProfileLibraryRow[]}>(viewer,key(owner,kind));
 return row.value?.items?.filter(x=>safe(owner,kind,x)).slice(0,100)??null;
}
export async function writeProfileLibrary(viewer:string,owner:string,kind:ProfileLibraryKind,items:ProfileLibraryRow[],lease?:number){
 const current=await readNativeCatalog(viewer,key(owner,kind));
 const clean=items.filter(x=>safe(owner,kind,x)).slice(0,100).map(x=>({path:x.path,createdAt:x.createdAt,version:x.version||'',size:Number(x.size)||0}));
 return writeNativeCatalog(viewer,key(owner,kind),{items:clean},lease??current.epoch);
}
export async function removeProfileLibraryItem(viewer:string,owner:string,kind:ProfileLibraryKind,path:string){
 await window.ConnectNative!.request('history:catalog-retire',{userId:viewer,key:key(owner,kind),path});
 const rows=await readProfileLibrary(viewer,owner,kind);if(rows)await writeProfileLibrary(viewer,owner,kind,rows.filter(x=>x.path!==path));
 await retireCachedProfileFile(viewer,path);
}
export function profilePrefetchSelection(kind:ProfileLibraryKind,rows:ProfileLibraryRow[]){
 const caps={photos:{count:3,bytes:2*1024**2},videos:{count:1,bytes:4*1024**2},music:{count:1,bytes:4*1024**2}};
 const cap=caps[kind];return {cap,items:rows.filter(x=>(x.size||0)>0&&x.size!<=cap.bytes).slice(0,cap.count)};
}
export function allowProfilePrefetch(){
 const c=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
 return !c?.saveData&&!['slow-2g','2g'].includes(c?.effectiveType||'')&&document.visibilityState==='visible';
}
const warmups=new Map<string,{at:number;task:Promise<void>}>();
export async function warmProfileLibraries(client:SupabaseClient,viewer:string,owner:string,proxyUrl=(url:string)=>url,signal?:AbortSignal){
 if(!viewer||!owner||mediaCacheOwner()!==viewer)return;
 const epoch=mediaCacheEpoch(),valid=()=>!signal?.aborted&&cacheLeaseValid(viewer,epoch);
 const namespace=viewer+':'+owner,current=warmups.get(namespace);
 if(current&&Date.now()-current.at<120000)return current.task;
 const task=(async()=>{
  // Sequential catalog loads avoid bursts competing with visible chat requests.
  for(const kind of kinds){if(!valid())break;
   try{
    const lease=await readNativeCatalog<{items:ProfileLibraryRow[]}>(viewer,key(owner,kind));if(!valid())break;
    const result=await client.storage.from('connect-profile-media').list(owner+'/'+kind,{limit:300,sortBy:{column:'created_at',order:'desc'}});
    if(!valid())break;
    if(result.error){if(['401','403'].includes(String((result.error as any).statusCode))){await writeNativeCatalog(viewer,key(owner,kind),{items:[]},lease.epoch);for(const row of lease.value?.items||[])await purgeCachedProfileFile(viewer,row.path);}continue;}
    const rows=(result.data||[]).filter(x=>x.id&&x.name&&!/__(?:thumb\.webp|poster\.jpg)$/.test(x.name)).slice(0,100).map(x=>({path:owner+'/'+kind+'/'+x.name,createdAt:x.created_at||'',version:x.updated_at||x.created_at||'',size:Number(x.metadata?.size)||0}));
    await writeNativeCatalog(viewer,key(owner,kind),{items:rows},lease.epoch);
    if(rows.length<100){const listed=new Set(rows.map(x=>x.path));for(const old of lease.value?.items||[])if(!listed.has(old.path)&&valid())await removeProfileLibraryItem(viewer,owner,kind,old.path);}
    if(!valid()||!allowProfilePrefetch())continue;
    const {cap,items}=profilePrefetchSelection(kind,rows);const missing:ProfileLibraryRow[]=[];
    for(const row of items)if(!await resolveCachedProfileFile(viewer,row.path,row.version))missing.push(row);
    if(!missing.length||!valid())continue;
    const signed=await client.storage.from('connect-profile-media').createSignedUrls(missing.map(x=>x.path),3600);
    if(!valid()||signed.error)continue;
    for(const item of signed.data||[]){if(!valid()||!allowProfilePrefetch())break;if(item.signedUrl)await prefetchProfileFile(proxyUrl(item.signedUrl),viewer,kind,cap.bytes,epoch,signal);}
   }catch{/* A network/cache failure preserves the last usable catalog. */}
  }
 })();warmups.set(namespace,{at:Date.now(),task});if(warmups.size>24)warmups.delete(warmups.keys().next().value!);return task;
}
export const warmOwnProfileLibraries=(client:SupabaseClient,viewer:string,proxy?:(url:string)=>string,signal?:AbortSignal)=>warmProfileLibraries(client,viewer,viewer,proxy,signal);
export const warmPeerProfileLibraries=(client:SupabaseClient,viewer:string,peer:string,proxy?:(url:string)=>string,signal?:AbortSignal)=>warmProfileLibraries(client,viewer,peer,proxy,signal);
