import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
const folder=await mkdtemp(join(tmpdir(),'connect-cache-browser-'));
const result=await build({entryPoints:[resolve('tests/browser-cache.tsx')],bundle:true,format:'esm',target:'chrome110',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY':'""','process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://project.supabase.co"','process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'"test-publishable"'}});
const script=result.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body><script type="module">'+script.replace(/<\/script/g,'<\\/script')+'</script></body></html>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const chrome=spawn(process.env.CHROMIUM_PATH||'/usr/bin/chromium',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+folder,'about:blank']);
// Wait for the entire Chromium process to close before deleting its user-data directory.
// A fixed delay is not sufficient: its subprocesses can still write into Default/.
const chromeClosed=new Promise(done=>{chrome.once('close',done);chrome.once('error',done);});
let socket,serial=0,errors=[];const waiting=new Map();
const deadline=setTimeout(()=>{chrome.kill('SIGKILL');for(const x of waiting.values())x.reject(Error('Browser integration timeout: '+JSON.stringify(errors)));},60000);
try{
 const endpoint=await new Promise((done,reject)=>{let text='';chrome.stderr.on('data',x=>{text+=x;const m=/DevTools listening on (ws:\/\/[^\s]+)/.exec(text);if(m)done(m[1]);});chrome.on('error',reject);chrome.on('exit',code=>reject(Error('Chromium exited '+code)));});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const data=JSON.parse(String(event.data));if(data.id){const item=waiting.get(data.id);if(item){waiting.delete(data.id);data.error?item.reject(Error(JSON.stringify(data.error))):item.resolve(data.result);}}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port},sessionId);
 const result=await send('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const started=Date.now();const poll=()=>{const node=document.getElementById('connect-cache-results');if(node)resolve(JSON.parse(node.textContent));else if(Date.now()-started>45000)reject(Error('No results; '+document.title));else setTimeout(poll,50);};poll();})`,awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw Error(JSON.stringify({exception:result.exceptionDetails,errors}));
 const report=result.result.value;console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
}finally{
 clearTimeout(deadline);
 try{socket?.close();}catch{/* Chromium might have closed the CDP socket already. */}
 chrome.kill('SIGTERM');
 const forceKill=setTimeout(()=>chrome.kill('SIGKILL'),5000);
 try{await chromeClosed;}finally{clearTimeout(forceKill);}
 await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
 await rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
