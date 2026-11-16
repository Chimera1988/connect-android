/** Stable presentation data, independent of expiring signed URLs and React remounts.
 * Current non-E2EE PWA only. A future E2EE rollout MUST re-audit local persistence.
 */
export type ChatWave={bars:number[];duration:number};
export function isNativeMediaRuntime():boolean {
  return typeof window!=='undefined'&&Boolean(window.ConnectAndroid||window.ConnectNative);
}
const waveMemory=new Map<string,ChatWave>();
const posterMemory=new Map<string,{url:string;until:number}>();
const waveKey=(user:string,path:string)=>`connect-chat-wave-v1:${user}:${path}`;
const posterKey=(user:string,path:string)=>`${user}:${path}`;
export function readChatWave(user:string,path:string):ChatWave|null{
  if(!user||!path)return null;
  const key=waveKey(user,path),hot=waveMemory.get(key);
  if(hot)return hot;
  try{
    const raw=localStorage.getItem(key);
    if(!raw)return null;
    const value=JSON.parse(raw) as ChatWave;
    if(!Array.isArray(value.bars)||value.bars.length!==43||!value.bars.every(x=>Number.isFinite(x)&&x>=0&&x<=1)||!Number.isFinite(value.duration)||value.duration<=0)return null;
    waveMemory.set(key,value);
    return value;
  }catch{return null;}
}
export function rememberChatWave(user:string,path:string,value:ChatWave){
  if(!user||!path||value.bars.length!==43||!Number.isFinite(value.duration)||value.duration<=0)return;
  const normalized={bars:value.bars.map(n=>Math.max(0,Math.min(1,n))),duration:value.duration};
  const key=waveKey(user,path);
  waveMemory.set(key,normalized);
  if(waveMemory.size>600)waveMemory.delete(waveMemory.keys().next().value!);
  try{localStorage.setItem(key,JSON.stringify(normalized));}catch{/* UI still works without persistent storage. */}
}
export function getHotChatPoster(user:string,path:string):string|null{
  if(isNativeMediaRuntime())return null;
  const value=posterMemory.get(posterKey(user,path));
  if(!value||value.until<Date.now()){posterMemory.delete(posterKey(user,path));return null;}
  return value.url;
}
export function rememberChatPoster(user:string,path:string,url:string){
  if(isNativeMediaRuntime()||!user||!path||!url)return;
  posterMemory.set(posterKey(user,path),{url,until:url.startsWith('blob:')||url.startsWith('data:')?Number.MAX_SAFE_INTEGER:Date.now()+48*60*1000});
  if(posterMemory.size>400)posterMemory.delete(posterMemory.keys().next().value!);
}
export function forgetUserChatPresentation(user:string){
  for(const key of waveMemory.keys())if(key.startsWith(`connect-chat-wave-v1:${user}:`))waveMemory.delete(key);
  for(const key of posterMemory.keys())if(key.startsWith(user+':'))posterMemory.delete(key);
}

/** Compute wave peaks for a small voice file before the chat becomes visible.
 * Large/remote audio still loads on demand. Never preload full-size video here.
 */
export async function prewarmChatWave(user:string,path:string,src:string,size:number=0):Promise<void>{
  if(isNativeMediaRuntime()||!user||!path||!src||size<=0||readChatWave(user,path)||size>2*1024*1024)return;
  let context:AudioContext|null=null;
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),7000);
    let bytes:ArrayBuffer;
    try{
      const response=await fetch(src,{signal:controller.signal});
      if(!response.ok) return;
      const length=Number(response.headers.get('content-length')||0);
      if(length>2*1024*1024)return;
      bytes=await response.arrayBuffer();
      if(bytes.byteLength>2*1024*1024)return;
    }finally{clearTimeout(timeout);}
    context=new AudioContext();
    const decoded=await context.decodeAudioData(bytes);
    const samples=decoded.getChannelData(0),count=43;
    const peaks=Array.from({length:count},(_,i)=>{
      const start=Math.floor(i*samples.length/count),end=Math.max(start+1,Math.floor((i+1)*samples.length/count));
      const stride=Math.max(1,Math.floor((end-start)/140));let peak=0;
      for(let j=start;j<end;j+=stride)peak=Math.max(peak,Math.abs(samples[j]||0));
      return peak;
    });
    const max=Math.max(.001,...peaks);
    rememberChatWave(user,path,{bars:peaks.map(x=>Math.max(.14,Math.min(1,Math.pow(x/max,.72)))),duration:decoded.duration});
  }catch{/* Audio decode is optional; playback retains its network fallback. */}
  finally{if(context)void context.close().catch(()=>{});}
}
