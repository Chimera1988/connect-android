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
import {prefetchStickerWebp,prefetchChatAudio,resolveCachedMedia} from '../web/lib/media-cache';
import {rememberChatWave,readChatWave,forgetUserChatPresentation} from '../web/lib/chat-media-presentation';
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
await test('Android compact Connect sounds migrate legacy choice and use native actions',async()=>{
 const previousBridge=window.ConnectNative;
 window.ConnectNative={request:async command=>{assert(command==='notification:diagnostics','unexpected diagnostic command');return [{stage:'received',at:'2026-11-15T10:00:00Z'}];}};
 const commands:{kind:string;value?:any}[]=[],writes:any[]=[];
 const previous=window.ConnectAndroid;
 (window as any).ConnectAndroid={
  getSoundSettings:()=>JSON.stringify({message:'Connect — сообщение',call:'Connect — звонок',messageCustom:false,callCustom:false,messageSilent:false,callSilent:false}),
  canShowFullScreenCalls:()=>true,
  setPreferences:(value:string)=>commands.push({kind:'preferences',value:JSON.parse(value)}),
  pickSound:(value:string)=>commands.push({kind:'pick',value}),
  previewSound:(value:string)=>commands.push({kind:'preview',value}),
  resetSound:(value:string)=>commands.push({kind:'reset',value}),
  setSilent:(kind:string,muted:boolean)=>commands.push({kind:'mute',value:kind+':'+muted}),
  stopPreviewSound:()=>commands.push({kind:'stop'}),
  openCallNotificationSettings:()=>commands.push({kind:'system'}),
 };
 localStorage.setItem('connect-notification-prefs-'+viewer,JSON.stringify({enabled:true,sound:'legacy-soft',vibrate:true}));
 const client:any={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{enabled:true,sound:'soft',vibrate:true}})})}),upsert:async(value:any)=>{writes.push(value);return{};}})};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 let unmounted=false;
 try{
  root.render(<ConnectNotificationSettings supabase={client} userId={viewer}/>);
  for(let i=0;i<100&&(container.querySelectorAll('.connect-sound-card').length!==2||commands.filter(x=>x.kind==='preferences').length<2);i++)await delay();
  const cards=Array.from(container.querySelectorAll('.connect-sound-card')) as HTMLElement[];
  assert(cards.length===2,'expected exactly two Connect sound controls');
  assert(!container.querySelector('#connect-sound'),'obsolete standard tone dropdown is still present');
  assert(!container.textContent?.includes('Яркий')&&!container.textContent?.includes('Нежный')&&!container.textContent?.includes('Мягкий (прежний)'),'obsolete presets are exposed');
  assert(container.textContent?.includes('Connect — звонок')&&container.textContent?.includes('Connect — сообщение'),'Connect default sound labels missing');
  assert(commands.filter(x=>x.kind==='preferences').at(-1)?.value?.sound==='soft','legacy preset was not normalized to Connect default');
  assert(JSON.parse(localStorage.getItem('connect-notification-prefs-'+viewer)||'{}').sound==='soft','normalized sound was not stored locally');
  for(const card of cards){
   assert(card.querySelectorAll('.connect-sound-icon-button').length===4,'sound actions must be four icon buttons');
   assert(Array.from(card.querySelectorAll('.connect-sound-icon-button')).every(x=>!x.textContent?.trim()),'icon actions unexpectedly show text labels');
  }
  const call=cards.find(x=>x.querySelector('strong')?.textContent==='Входящий аудиозвонок')!;
  const message=cards.find(x=>x.querySelector('strong')?.textContent==='Сообщение')!;
  assert(call&&message,'call or message sound section missing');
  const action=(card:HTMLElement,start:string)=>card.querySelector(`button[aria-label^="${start}"]`) as HTMLButtonElement|null;
  const selectCall=action(call,'Выбрать'),previewCall=action(call,'Прослушать'),stopCall=action(call,'Остановить');
  if(!selectCall||!previewCall||!stopCall)throw new Error('native call sound controls missing');
  selectCall.click();previewCall.click();stopCall.click();
  assert(commands.some(x=>x.kind==='pick'&&x.value==='call'),'native call melody picker not called');
  assert(commands.some(x=>x.kind==='preview'&&x.value==='call'),'native call melody preview not called');
  assert(commands.some(x=>x.kind==='stop'),'native sound preview stop not called');
  const mute=message.querySelector('.connect-sound-mute input[type="checkbox"]') as HTMLInputElement|null;
  if(!mute)throw new Error('message mute checkbox missing');mute.click();
  assert(commands.some(x=>x.kind==='mute'&&x.value==='message:true'),'native message mute was not applied');
  const reset=action(message,'Сбросить');if(!reset)throw new Error('message reset icon missing');reset.click();
  for(let i=0;i<50&&!writes.length;i++)await delay();
  assert(writes.at(-1)?.sound==='soft','Connect default sound was not persisted with existing server enum');
  assert(commands.some(x=>x.kind==='reset'&&x.value==='message'),'native default reset missing');
  const advanced=container.querySelector('details.connect-android-advanced') as HTMLDetailsElement|null;
  if(!advanced)throw new Error('native diagnostic settings are missing');advanced.open=true;
  const journal=Array.from(advanced.querySelectorAll('button')).find(x=>x.textContent==='Журнал уведомлений') as HTMLButtonElement|undefined;
  if(!journal)throw new Error('native journal action missing');journal.click();
  for(let i=0;i<30&&!container.querySelector('pre');i++)await delay();
  assert(container.querySelector('pre')?.textContent?.includes('received'),'journal was not shown from native boundary');
  const before=commands.filter(x=>x.kind==='stop').length;
  root.unmount();unmounted=true;
  assert(commands.filter(x=>x.kind==='stop').length>before,'unmount left preview playing');
 }finally{
  if(!unmounted)root.unmount();container.remove();
  window.ConnectAndroid=previous;window.ConnectNative=previousBridge;
  localStorage.removeItem('connect-notification-prefs-'+viewer);
 }
});
await test('personal sticker bytes survive new signatures and are isolated to the owner',async()=>{
 stop();activeOwner=viewer;stop=installMediaCache(viewer);
 const url=location.origin+'/storage/v1/object/sign/connect-stickers/'+peer+'/private-sticker.webp?token=one';
 await prefetchStickerWebp(url,viewer);const count=downloads;
 await prefetchStickerWebp(url.replace('token=one','token=two'),viewer);
 assert(downloads===count,'sticker downloaded again for a new signature');
 const local=await resolveCachedMedia(url,viewer);assert(local.startsWith('blob:'),'sticker was not persisted');
 assert((await resolveCachedMedia(url,other))===url,'sticker escaped owner isolation');
});
await test('streaming play does not issue an extra original fetch; small explicit audio warmup is deduplicated',async()=>{
 const url=location.origin+'/storage/v1/object/sign/connect-attachments/'+viewer+'/lazy-voice.m4a?token=one';
 const before=downloads;const elements=['audio','video'].map(tag=>{const el=document.createElement(tag) as HTMLMediaElement;el.preload='none';el.src=url;document.body.append(el);return el;});
 await delay();for(const el of elements)el.dispatchEvent(new Event('play',{bubbles:true}));
 for(let i=0;i<8;i++)await delay();assert(downloads===before,'play caused a parallel fetch of original media');
 await Promise.all([prefetchChatAudio(url,viewer,512),prefetchChatAudio(url,viewer,512)]);
 assert(downloads===before+1,'small audio cache did not deduplicate');
 for(const el of elements)el.remove();
});
await test('native waveform presentation survives remount without crossing account boundaries',async()=>{
 const path=viewer+'/wave.m4a',bars=Array.from({length:43},(_,i)=>(i+1)/43);
 rememberChatWave(viewer,path,{bars,duration:4});forgetUserChatPresentation(viewer);
 assert(readChatWave(viewer,path)?.duration===4,'native decoded wave was not persisted');
 assert(readChatWave(other,path)===null,'wave leaked to another account');
 localStorage.removeItem('connect-chat-wave-v1:'+viewer+':'+path);forgetUserChatPresentation(viewer);
});
stop();document.body.innerHTML='';const output=document.createElement('pre');output.id='connect-cache-results';output.textContent=JSON.stringify({results,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length});document.body.append(output);
