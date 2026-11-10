/** Safe, bounded diagnostics: no SDP, ICE addresses, tokens or audio samples. */
type Entry = {at:number;device:string;callId:string;stage:string;state:string;code:string};
let device='';
const entries:Entry[]=[];
function deviceId(){
  if(device)return device;
  try{const old=localStorage.getItem('connect-call-diagnostic-device');device=old&&/^[a-f0-9-]{36}$/i.test(old)?old:crypto.randomUUID();localStorage.setItem('connect-call-diagnostic-device',device);}
  catch{device='temporary';}
  return device;
}
export function traceCall(callId:string|undefined,stage:string,state='',code=''){
  const clean=(v:string)=>v.replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,80);
  const entry:Entry={at:Date.now(),device:deviceId(),callId:clean(callId||''),stage:clean(stage),state:clean(state),code:clean(code)};
  entries.push(entry);if(entries.length>200)entries.shift();
  console.info('ConnectCall',entry);
}
export function callDiagnostics(){return entries.map(entry=>({...entry}));}
