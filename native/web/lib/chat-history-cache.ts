import type {} from '../hybrid/bridge-types';
/** Android history is native SQLite, never browser IndexedDB. Auth is checked
 * again in the native module; the WebView never receives database paths/keys.
 */
import {compareChatMessages} from './chat-order';
type Row={id:string;conversation_id:string;created_at:string;deleted_at?:string|null};
type Snapshot<T>={messages:T[];readAt:string;savedAt:number;hasMore?:boolean;hasNewer?:boolean};
type Packet<T>=Snapshot<T>&{epoch:number;continuation:string|null};
export type NativeHistoryStats={chats:number;messages:number;bytes:number;epoch:number;nativeSystemBytes:number};
const hot=new Map<string,{snapshot:Snapshot<any>;at:number}>();
const reading=new Map<string,Promise<Snapshot<any>>>();
const generations=new Map<string,number>();
const verified=new Map<string,number>();
const keyFor=(user:string,chat:string)=>user+':'+chat;
function warm(key:string,value:Snapshot<any>){hot.delete(key);hot.set(key,{snapshot:value,at:Date.now()});while(hot.size>12)hot.delete(hot.keys().next().value!);}
function invalidate(user:string,chat?:string){for(const key of new Set([...hot.keys(),...reading.keys()]))if(key.startsWith(user+':')&&(!chat||key===keyFor(user,chat))){hot.delete(key);generations.set(key,(generations.get(key)||0)+1);}}
export function releaseHistoryMemory(){hot.clear();verified.clear();feedFingerprints.clear();for(const key of reading.keys())generations.set(key,(generations.get(key)||0)+1);}
export function chatNetworkDue(user:string,chat:string){return Date.now()-(verified.get(keyFor(user,chat))||0)>=20000;}
export function chatNetworkVerified(user:string,chat:string){verified.set(keyFor(user,chat),Date.now());while(verified.size>24)verified.delete(verified.keys().next().value!);}
export async function prewarmChatHistory(user:string,chat:string){await readChatHistory(user,chat);}
const epochs=new Map<string,number>();
const writes=new Map<string,Promise<void>>();
async function request(command:string,userId:string,data:Record<string,unknown>={}){
  if(!window.ConnectNative)throw Error('Нативное хранилище ещё не готово');
  return window.ConnectNative.request('history:'+command,{userId,...data});
}
async function snapshot<T extends Row>(user:string,chat:string,command:string,data:Record<string,unknown>={}):Promise<Snapshot<T>>{
  let packet=await request(command,user,{conversationId:chat,...data}) as Packet<T>;
  if(!Number.isSafeInteger(packet.epoch)||!Array.isArray(packet.messages))throw Error('Некорректная локальная история');
  const epoch=packet.epoch;epochs.set(user,epoch);const byId=new Map<string,T>();
  for(let part=0;part<501;part++){
    if(packet.epoch!==epoch)throw Error('Локальная история обновилась');
    for(const row of packet.messages)if(row.conversation_id===chat&&!row.deleted_at)byId.set(row.id,row);
    if(!packet.continuation)return{messages:[...byId.values()].sort(compareChatMessages),readAt:packet.readAt,savedAt:packet.savedAt,hasMore:packet.hasMore,hasNewer:packet.hasNewer};
    packet=await request('chunk',user,{continuation:packet.continuation}) as Packet<T>;
  }
  throw Error('Слишком много частей локальной истории');
}
export async function readChatHistory<T extends Row>(user:string,chat:string):Promise<Snapshot<T>|null>{
  if(!user||!chat)return null;
  const key=keyFor(user,chat),cached=hot.get(key);if(cached&&Date.now()-cached.at<20000){warm(key,cached.snapshot);return cached.snapshot;}
  if(reading.has(key))return reading.get(key)!;
  const task=(async()=>{
    // Inbox writes can overlap chunked hydration. Retry against the same native
    // database rather than dropping an otherwise available offline history.
    for(let attempt=0;attempt<3;attempt++){
      const generation=generations.get(key)||0,value=await snapshot<T>(user,chat,'read');
      if((generations.get(key)||0)===generation){warm(key,value);return value;}
    }
    throw Error('История обновляется, повторите открытие');
  })().finally(()=>{if(reading.get(key)===task)reading.delete(key);});
  reading.set(key,task);return task;
}
export async function readOlderChatHistory<T extends Row>(user:string,chat:string,before:string,beforeId:string):Promise<Snapshot<T>|null>{
  if(!user||!chat)return null;return snapshot<T>(user,chat,'page',{before,beforeId});
}
export async function readNewerChatHistory<T extends Row>(user:string,chat:string,before:string,beforeId:string):Promise<Snapshot<T>|null>{
  if(!user||!chat)return null;return snapshot<T>(user,chat,'page',{before,beforeId,direction:'after'});
}
export function writeChatHistory<T extends Row>(user:string,chat:string,messages:T[],readAt='',replace=false):Promise<void>{
  if(!user||!chat)return Promise.resolve();
  // Capture the lease before queueing. A clear must not grant old pending work
  // the new epoch just because its bridge request happens to arrive later.
  const lease=epochs.has(user)?Promise.resolve(epochs.get(user)!):chatHistoryStats(user).then(s=>{if(!epochs.has(user))epochs.set(user,s.epoch);return s.epoch;});
  const frozen=messages.filter(m=>m.conversation_id===chat).map(m=>JSON.stringify(m));
  const key=user+':'+chat;
  const pending=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
    let epoch=await lease;
    if(replace){await wipeChatHistory(user,chat);await readChatHistory(user,chat);epoch=epochs.get(user)!;}
    let batch:unknown[]=[],bytes=0;
    const flush=async()=>{if(batch.length){await request('write',user,{conversationId:chat,messages:batch,readAt,epoch});batch=[];bytes=0;}};
    for(const json of frozen){const size=new TextEncoder().encode(json).length;if(size>72000)continue;if(bytes+size>72000||batch.length>=100)await flush();batch.push(JSON.parse(json));bytes+=size;}
    if(!frozen.length)await request('write',user,{conversationId:chat,messages:[],readAt,epoch});
    await flush();invalidate(user,chat);window.dispatchEvent(new Event('connect:history-cache-changed'));
  }).finally(()=>{if(writes.get(key)===pending)writes.delete(key);});
  writes.set(key,pending);return pending;
}
export async function dropCachedMessage(user:string,_chat:string,id:string){if(user&&id){invalidate(user);await request('drop',user,{messageId:id});}}
export async function dropCachedMessageById(user:string,id:string){if(user&&id){invalidate(user);await request('drop',user,{messageId:id});}}
export async function wipeChatHistory(user:string,chat:string){if(user&&chat){invalidate(user,chat);await request('wipe',user,{conversationId:chat});}}
export async function wipeUserHistory(user:string){if(user){invalidate(user);await request('wipe',user);}}
export async function chatHistoryStats(user:string):Promise<NativeHistoryStats>{
  if(!user)return{chats:0,messages:0,bytes:0,epoch:0,nativeSystemBytes:0};return request('stats',user);
}
export async function setNativeHistoryLimit(user:string,limit:string){if(user)await request('limit',user,{limit});}

/** Reuse already authorized inbox rows; no extra SELECT of message history. */
export async function seedInboxHistory<T extends Row>(user:string,rows:T[],readTimes:Record<string,string>,signal?:AbortSignal){
 const grouped=new Map<string,T[]>();
 for(const row of rows){if(!row.deleted_at){const list=grouped.get(row.conversation_id)||[];if(list.length<200)list.push(row);grouped.set(row.conversation_id,list);}}
 for(const [chat,messages] of [...grouped].slice(0,8)){
   if(signal?.aborted)break;
   const fingerprint=messages.map(m=>JSON.stringify(m)).join('')+'|'+(readTimes[chat]||'');
   const key=user+':'+chat;
   if(feedFingerprints.get(key)===fingerprint)continue;
   await writeChatHistory(user,chat,messages,readTimes[chat]||'');
   if(signal?.aborted)break;feedFingerprints.set(key,fingerprint);
   if(feedFingerprints.size>16)feedFingerprints.delete(feedFingerprints.keys().next().value!);
   await prewarmChatHistory(user,chat);
 }
}
const feedFingerprints=new Map<string,string>();
