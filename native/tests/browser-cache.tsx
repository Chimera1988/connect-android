/** Chromium integration with real IndexedDB and an explicit native-bridge test double.
 * This does not emulate Android SQLite, FCM, Telecom or a physical sensor.
 */
import React from 'react';
import {createRoot} from 'react-dom/client';
import ConnectNotificationSettings from '../web/components/ConnectNotificationSettings';
import ConnectProfileMedia from '../web/components/ConnectProfileMedia';
import {ConnectMusicProvider,ConnectMusicLibrary} from '../web/components/ConnectMusicSystem';
import {safeCatalog} from '../src/hybridProtocol';
import {installMediaCache,prefetchProfileFile,resolveCachedProfileFile,retireCachedProfileFile,boundedMediaBody,clearCachedMedia,cacheStats,prefetchCachedMedia} from '../web/lib/media-cache';
import {readProfileLibrary,writeProfileLibrary,warmPeerProfileLibraries,profilePrefetchSelection} from '../web/lib/profile-media-index';
import {readChatHistory,writeChatHistory,dropCachedMessage,releaseHistoryMemory} from '../web/lib/chat-history-cache';
const results:{name:string;pass:boolean;error?:string}[]=[];
const assert=(value:unknown,label:string)=>{if(!value)throw Error(label);};
const test=async(name:string,fn:()=>Promise<void>)=>{document.title=name;try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e)});}};
const viewer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',peer='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const profileRetired=new Set<string>();
const catalogs=new Map<string,any>(),history=new Map<string,any[]>(),retired=new Set<string>();let reads=0,downloads=0;let holdRead=false,releaseRead:(()=>void)|undefined;
(window as any).ConnectNative={request:async(command:string,p:any)=>{
 if(p.userId!==activeOwner)throw Error('Account changed');
 const key=p.userId+':'+(p.key||p.conversationId);
 if(command==='history:catalog-read'){const saved=catalogs.get(key);return{value:saved?.items?{items:saved.items.filter((x:any)=>!profileRetired.has(p.userId+':'+x.path))}:saved||null,epoch:1};}
 if(command==='history:catalog-write'){assert(safeCatalog(p.value),'unsafe catalog');if(p.epoch!==1)return{stored:false};catalogs.set(key,structuredClone(p.value.items?{items:p.value.items.filter((x:any)=>!profileRetired.has(p.userId+':'+x.path))}:p.value));return{stored:true};}
 if(command==='history:catalog-retire'){profileRetired.add(p.userId+':'+p.path);return{};}
 if(command==='history:catalog-drop'){catalogs.delete(key);return{};}
 if(command==='history:stats')return{epoch:1,bytes:0};
 if(command==='history:read'){reads++;if(holdRead){holdRead=false;await new Promise<void>(done=>releaseRead=done);}return{messages:history.get(key)||[],readAt:'',savedAt:1,epoch:1,continuation:null};}
 if(command==='history:write'){const rows=new Map((history.get(key)||[]).map(x=>[x.id,x]));for(const row of p.messages)if(!retired.has(p.userId+':'+row.id))rows.set(row.id,row);history.set(key,[...rows.values()]);return{stored:true};}
 if(command==='history:drop'){retired.add(p.userId+':'+p.messageId);for(const [k,rows]of history)if(k.startsWith(p.userId+':'))history.set(k,rows.filter(x=>x.id!==p.messageId));return{};}
 throw Error('Unexpected test bridge '+command);
}};
let activeOwner=viewer,stop=installMediaCache(viewer);
const pixel=document.createElement('canvas');pixel.width=pixel.height=1;const imageBytes=Uint8Array.from(atob(pixel.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
const originalFetch=window.fetch.bind(window);let pendingRelease:(()=>void)|undefined;
window.fetch=async(input,init)=>{
 const url=String(input);if(!url.includes('/storage/v1/object/'))return originalFetch(input,init);
 downloads++;
 if(url.includes('pending'))await new Promise<void>(resolve=>pendingRelease=resolve);
 return new Response(url.includes('/music/')||url.includes('/videos/')?new Uint8Array([1,2,3,4]):imageBytes,{status:200,headers:{'Content-Type':url.includes('/music/')?'audio/mpeg':url.includes('/videos/')?'video/mp4':'image/png'}});
};
const signed=(path:string,token='one')=>location.origin+'/storage/v1/object/sign/connect-profile-media/'+path+'?token='+token;
const delay=()=>new Promise(resolve=>setTimeout(resolve,0));
await test('real IndexedDB reuses bytes across expiring signed URLs and honors versions',async()=>{
 const path=peer+'/photos/a.webp';assert(!await resolveCachedProfileFile(viewer,path,'v1'),'initial miss');
 await prefetchProfileFile(signed(path),viewer,'photos',2048);const count=downloads;
 const local=await resolveCachedProfileFile(viewer,path,'v1');assert(local?.startsWith('blob:'),'local object URL');
 await prefetchProfileFile(signed(path,'new-token'),viewer,'photos',2048);assert(downloads===count,'signed URL change downloaded twice');
 assert(!await resolveCachedProfileFile(viewer,path,'v2'),'stale version reused');await prefetchProfileFile(signed(path),viewer,'photos',2048);
 const fresh=await resolveCachedProfileFile(viewer,path,'v2');assert(fresh&&fresh!==local,'version did not invalidate object URL');
});
await test('streaming cap cancels oversized data even without content length',async()=>{
 let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4096));c.enqueue(new Uint8Array(4096));},cancel(){cancelled=true;}}));
 assert(await boundedMediaBody(response,1024)===null&&cancelled,'unbounded download');
});
await test('retired profile path cannot be restored by an in-flight download',async()=>{
 const path=peer+'/photos/pending.webp';const task=prefetchProfileFile(signed(path),viewer,'photos',2048);
 while(!pendingRelease)await delay();await retireCachedProfileFile(viewer,path);pendingRelease();pendingRelease=undefined;await task;
 assert(!await resolveCachedProfileFile(viewer,path),'retired bytes resurrected');
});
await test('account change cancels pending cache writes and isolates downloaded media',async()=>{
 const path=peer+'/photos/pending-account.webp',task=prefetchProfileFile(signed(path),viewer,'photos',2048);
 while(!pendingRelease)await delay();stop();activeOwner=other;stop=installMediaCache(other);pendingRelease();pendingRelease=undefined;await task;
 assert(!await resolveCachedProfileFile(other,peer+'/photos/a.webp'),'other account read bytes');
 stop();activeOwner=viewer;stop=installMediaCache(viewer);assert(!await resolveCachedProfileFile(viewer,path),'old download survived logout');
});
await test('SQLite catalog bridge stores stable paths only and isolates viewer and media owner',async()=>{
 const row={path:peer+'/photos/a.webp',createdAt:'2026-11-11T00:00:00Z',version:'v2',size:4};await writeProfileLibrary(viewer,peer,'photos',[row]);
 assert((await readProfileLibrary(viewer,peer,'photos'))?.[0].path===row.path,'catalog not restored');assert(await readProfileLibrary(viewer,viewer,'photos')===null,'wrong owner catalog');
 assert(!JSON.stringify([...catalogs.values()]).includes('token='),'signed URL persisted');
 for(const value of [{token:'secret'},{url:signed(row.path)},{credential:'eyJabc.payload.signature'}])assert(!safeCatalog(value),'credentials accepted');
 activeOwner=other;assert(await readProfileLibrary(other,peer,'photos')===null,'wrong viewer catalog');activeOwner=viewer;
});
await test('peer warmup limits three photos, one video and one track and skips oversized files',async()=>{
 const rows=(kind:string)=>Array.from({length:8},(_,i)=>({id:String(i),name:'budget-'+i+(kind==='music'?'.mp3':kind==='videos'?'.mp4':'.webp'),created_at:'2026-11-11T00:00:00Z',updated_at:'v1',metadata:{size:i===0?10*1024**2:1000}}));
 let signCount=0;
 const client:any={storage:{from:()=>({list:async(directory:string)=>({data:rows(directory.split('/')[1])}),createSignedUrls:async(paths:string[])=>{signCount+=paths.length;return{data:paths.map(path=>({path,signedUrl:signed(path)}))};}})}};
 await warmPeerProfileLibraries(client,viewer,peer);
 assert(signCount===5,'prefetch selected '+signCount+' files instead of 5');
 for(const kind of ['photos','videos','music'] as const){const selection=profilePrefetchSelection(kind,[{path:'huge',createdAt:'',size:100*1024**2}]);assert(selection.items.length===0,'large original selected');}
});
await test('hot history opens offline, deduplicates native reads and honors deletion',async()=>{
 const chat='dddddddd-dddd-4ddd-8ddd-dddddddddddd',row={id:'message',conversation_id:chat,created_at:'2026-11-11T00:00:00Z'};
 await writeChatHistory(viewer,chat,[row]);const before=reads;const [one,two]=await Promise.all([readChatHistory(viewer,chat),readChatHistory(viewer,chat)]);
 assert(one?.messages.length===1&&two?.messages.length===1&&reads===before+1,'duplicate native reads');
 await readChatHistory(viewer,chat);assert(reads===before+1,'hot window reloaded');
 await dropCachedMessage(viewer,chat,row.id);await writeChatHistory(viewer,chat,[row]);assert((await readChatHistory(viewer,chat))?.messages.length===0,'deleted message resurrected');
 releaseHistoryMemory();assert((await readChatHistory(viewer,chat))?.messages.length===0,'tombstone lost on memory clear');
});
await test('inbox write during chunk hydration retries without losing cached history',async()=>{
 const chat='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',one={id:'one',conversation_id:chat,created_at:'2026-11-11T00:00:00Z'},two={...one,id:'two'};
 await writeChatHistory(viewer,chat,[one]);releaseHistoryMemory();holdRead=true;
 const loading=readChatHistory(viewer,chat);while(!releaseRead)await delay();
 await writeChatHistory(viewer,chat,[two]);releaseRead();releaseRead=undefined;
 assert((await loading)?.messages.length===2,'hydration discarded after concurrent inbox write');
});
await test('profile UI displays cached catalog while server list is unavailable',async()=>{
 const row={path:peer+'/photos/offline.webp',createdAt:'2026-11-11T00:00:00Z',size:4};await writeProfileLibrary(viewer,peer,'photos',[row]);await prefetchProfileFile(signed(row.path),viewer,'photos',2048);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 let gallerySigns=0;const client:any={storage:{from:()=>({list:()=>new Promise(()=>{}),createSignedUrl:async(path:string)=>{gallerySigns++;return{data:{signedUrl:signed(path,'gallery-refreshed')}};}})}};
 root.render(<ConnectProfileMedia client={client} viewerId={viewer} userId={peer} kind="photos" onBack={()=>{}} onAvatar={()=>{}} isOwner={false}/>);
 for(let i=0;i<20&&!container.querySelector('.connect-profile-photo-grid');i++)await delay();
 assert(!!container.querySelector('.connect-profile-photo-grid'),'cached list hidden behind network');assert(!container.textContent?.includes('Загружаем медиатеку'),'eternal spinner');
 (container.querySelector('.connect-profile-photo-thumb') as HTMLButtonElement).click();
 for(let i=0;i<25&&!document.querySelector('.connect-full-gallery-stage img');i++)await delay();
 assert(document.querySelector('.connect-full-gallery-stage img')?.getAttribute('src')?.startsWith('blob:'),'gallery did not use local bytes');
 (document.querySelector('.connect-full-gallery-icon[aria-label="Закрыть просмотр"]') as HTMLButtonElement).click();await delay();await clearCachedMedia('temporary');
 (container.querySelector('.connect-profile-photo-thumb') as HTMLButtonElement).click();
 for(let i=0;i<25&&!gallerySigns;i++)await delay();
 for(let i=0;i<25&&!document.querySelector('.connect-full-gallery-stage img');i++)await delay();
 assert(gallerySigns===1&&document.querySelector('.connect-full-gallery-stage img')?.getAttribute('src')?.includes('gallery-refreshed'),'gallery reused a revoked blob URL after clearing');
 root.unmount();container.remove();
});
await test('ordinary media clear preserves system avatars and drops temporary bytes',async()=>{
 const avatar=location.origin+'/storage/v1/object/sign/connect-avatars/'+viewer+'/avatar.webp?token=one';
 await prefetchCachedMedia(avatar,viewer);assert((await cacheStats()).system>0,'avatar missing');
 await clearCachedMedia('temporary');const stats=await cacheStats();assert(stats.system>0&&stats.photos===0&&stats.videos===0&&stats.audio===0,'clear touched protected resources or retained temporary data');
});
await test('music selection obtains a network URL after its cached blob was cleared',async()=>{
 const path=peer+'/music/clear-player.mp3';await prefetchProfileFile(signed(path),viewer,'music',2048);const blob=await resolveCachedProfileFile(viewer,path);assert(blob,'missing music bytes');
 let signCount=0;
 const client:any={auth:{getUser:async()=>({data:{user:{id:viewer}}})},storage:{from:()=>({createSignedUrl:async()=>{signCount++;return{data:{signedUrl:signed(path,'refreshed')}};}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{is_public:false}})})}),upsert:async()=>({})})};
 const container=document.createElement('div');container.className='connect-app';document.body.append(container);const root=createRoot(container);
 const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.resolve();
 try{
  root.render(<ConnectMusicProvider><ConnectMusicLibrary client={client} ownerId={peer} items={[{path,name:'cached song',url:blob!}]} isOwner={false} busy={false} onRemove={()=>{}}/></ConnectMusicProvider>);
  for(let i=0;i<25&&!container.querySelector('.connect-minimal-track-main');i++)await delay();
  (container.querySelector('.connect-minimal-track-main') as HTMLButtonElement).click();
  for(let i=0;i<25&&!container.querySelector('audio')?.getAttribute('src');i++)await delay();
  assert(container.querySelector('audio')?.getAttribute('src')?.startsWith('blob:'),'cached song did not resolve locally');
  await clearCachedMedia('temporary');(container.querySelector('.connect-minimal-track-main') as HTMLButtonElement).click();
  for(let i=0;i<25&&!signCount;i++)await delay();
  assert(signCount===1,'cleared blob was reused instead of signing a network URL');
  assert(container.querySelector('audio')?.getAttribute('src')?.includes('token=refreshed'),'player source not refreshed');
 }finally{root.unmount();container.remove();HTMLMediaElement.prototype.play=play;}
});
await test('Android sound settings retain legacy choice, reset to MP3 default and stop preview on close',async()=>{
 const commands:{kind:string;value?:any}[]=[],writes:any[]=[];
 const previous=window.ConnectAndroid;
 (window as any).ConnectAndroid={
  getSoundSettings:()=>JSON.stringify({message:'Connect — сообщение',call:'Connect — звонок',messageCustom:false,callCustom:false,messageSilent:false,callSilent:false}),
  canShowFullScreenCalls:()=>true,setPreferences:(value:string)=>commands.push({kind:'preferences',value:JSON.parse(value)}),
  resetSound:(value:string)=>commands.push({kind:'reset',value}),previewBuiltInSound:(value:string)=>commands.push({kind:'preview',value}),stopPreviewSound:()=>commands.push({kind:'stop'}),
 };
 localStorage.setItem('connect-notification-prefs-'+viewer,JSON.stringify({enabled:true,sound:'legacy-soft',vibrate:true}));
 const client:any={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{enabled:true,sound:'soft',vibrate:true}})})}),upsert:async(value:any)=>{writes.push(value);return{};}})};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 try{
  root.render(<ConnectNotificationSettings supabase={client} userId={viewer}/>);
  for(let i=0;i<100&&(!container.querySelector('#connect-sound')||commands.filter(x=>x.kind==='preferences').length<2);i++)await new Promise(r=>setTimeout(r,5));
  const selector=container.querySelector('#connect-sound') as HTMLSelectElement;
  for(let i=0;i<100&&selector.value!=='legacy-soft';i++)await new Promise(r=>setTimeout(r,5));
  assert(selector.value==='legacy-soft','remote soft overwrote Android legacy choice: '+JSON.stringify(commands));
  assert(Array.from(selector.options).some(x=>x.value==='soft'&&x.textContent==='Connect — сообщение'),'new default label missing');
  assert(container.textContent?.includes('Connect — звонок'),'new call default label missing');
  const message=Array.from(container.querySelectorAll('strong')).find(x=>x.textContent==='Сообщение')!.parentElement!;
  (Array.from(message.querySelectorAll('button')).find(x=>x.textContent==='Сбросить') as HTMLButtonElement).click();
  for(let i=0;i<25&&!writes.length;i++)await delay();
  assert(selector.value==='soft'&&writes.at(-1)?.sound==='soft','reset not persisted with existing server enum');
  assert(commands.some(x=>x.kind==='reset'&&x.value==='message'),'native reset missing');
  const preview=Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Прослушать') as HTMLButtonElement;preview.click();
  assert(commands.some(x=>x.kind==='preview'&&x.value==='soft'),'preview did not select new default');
  const before=commands.filter(x=>x.kind==='stop').length;root.unmount();
  assert(commands.filter(x=>x.kind==='stop').length>before,'unmount left preview playing');
 }finally{root.unmount();container.remove();window.ConnectAndroid=previous;localStorage.removeItem('connect-notification-prefs-'+viewer);}
});
stop();document.body.innerHTML='';const output=document.createElement('pre');output.id='connect-cache-results';output.textContent=JSON.stringify({results,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length});document.body.append(output);
