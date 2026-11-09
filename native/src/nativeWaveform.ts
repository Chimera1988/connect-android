import {NativeModules,Platform} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

type WaveformModule={decode:(uri:string,count:number)=>Promise<number[]>};
const native=NativeModules.ConnectWaveform as WaveformModule|undefined;
const MAX_FILE_BYTES=128*1024*1024;
const pending=new Map<string,Promise<number[]>>();
const cached=new Map<string,number[]>();
const waiting:(()=>void)[]=[];
let active=0;

function scheduled(uri:string,count:number):Promise<number[]>{
  return new Promise((resolve,reject)=>{
    const start=()=>{
      active++;
      void decode(uri,count).then(resolve,reject).finally(()=>{
        active--;waiting.shift()?.();
      });
    };
    if(active<2)start();
    else waiting.push(start);
  });
}

async function decode(uri:string,count:number):Promise<number[]>{
  if(Platform.OS!=='android'||!native)throw new Error('Предварительная звуковая волна недоступна в этой сборке');
  let local=uri;
  let temporary:string|undefined;
  let download:ReturnType<typeof FileSystem.createDownloadResumable>|undefined;
  try {
    if(/^https?:\/\//i.test(uri)){
      if(!FileSystem.cacheDirectory)throw new Error('Кэш Android недоступен');
      temporary=FileSystem.cacheDirectory+`connect-waveform-${Date.now()}-${Math.random().toString(36).slice(2)}.audio`;
      let overLimit=false;
      const task=FileSystem.createDownloadResumable(uri,temporary,{},progress=>{
        if(progress.totalBytesWritten>MAX_FILE_BYTES||progress.totalBytesExpectedToWrite>MAX_FILE_BYTES){
          overLimit=true;void task.cancelAsync().catch(()=>{});
        }
      });
      download=task;
      let timeout:ReturnType<typeof setTimeout>|undefined;
      try {
        const result=await Promise.race([
          task.downloadAsync(),
          new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{
            void task.cancelAsync().catch(()=>{});
            reject(new Error('Загрузка аудио для волны заняла больше 45 секунд'));
          },45000);}),
        ]);
        if(overLimit)throw new Error('Аудиофайл превышает 128 МБ');
        if(!result||result.status<200||result.status>=300)throw new Error('Не удалось загрузить аудио для волны');
        local=result.uri;
      }finally{if(timeout)clearTimeout(timeout);}
    }
    const info=await FileSystem.getInfoAsync(local);
    if(!info.exists||info.isDirectory)throw new Error('Аудиофайл недоступен');
    if(info.size>MAX_FILE_BYTES)throw new Error('Аудиофайл превышает 128 МБ');
    const bars=await native.decode(local,count);
    if(bars.length!==count||bars.some(value=>!Number.isFinite(value)||value<0||value>1))throw new Error('Декодер вернул неверную волну');
    return bars;
  }finally{
    if(download)await download.cancelAsync().catch(()=>{});
    if(temporary)await FileSystem.deleteAsync(temporary,{idempotent:true}).catch(()=>{});
  }
}

/** Decodes the entire waveform without playing audio or asking for mic access. */
export function getAudioWaveform(uri:string,count=43):Promise<number[]>{
  const size=Number.isFinite(count)?Math.max(1,Math.min(128,Math.floor(count))):43;
  const key=size+':'+uri;
  const saved=cached.get(key);
  if(saved)return Promise.resolve([...saved]);
  const existing=pending.get(key);
  if(existing)return existing.then(bars=>[...bars]);
  // Two active jobs and up to sixteen waiting rows. A long conversation cannot
  // start unbounded parallel downloads or retain unbounded pending work.
  if(pending.size>=18)return Promise.reject(new Error('Очередь декодирования аудио занята'));
  const operation=scheduled(uri,size).then(bars=>{
    cached.set(key,bars);
    if(cached.size>32)cached.delete(cached.keys().next().value!);
    return bars;
  }).finally(()=>pending.delete(key));
  pending.set(key,operation);
  return operation.then(bars=>[...bars]);
}
