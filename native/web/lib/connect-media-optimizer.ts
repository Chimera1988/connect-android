// CONNECT_PWA_UNIFIED_MEDIA_QUALITY_20261115
/** CONNECT_PWA_SAFE_MEDIA_OPTIMIZATION_V1_20261115
 * Best-effort, local and bounded. The original File is never mutated.
 * No encoding occurs in the native Android wrapper.
 */
export type ConnectMediaDecision = 'optimized' | 'unchanged' | 'unsupported' | 'failed';
export type ConnectMediaResult = { file: File; decision: ConnectMediaDecision };
const KB = 1024;
const MB = 1024 * KB;
const IMAGE_MIN = 700 * KB;
const WAV_MIN = 1024 * KB;
const VIDEO_MIN = 4 * MB;
const MAX_UPLOAD = 100 * MB;
const MAX_CANVAS_SIDE = 2048;
const WAV_MAX = 24 * MB;
const VIDEO_MAX_SECONDS = 150;

export function connectCanOptimizeMedia(file: File, native = false): 'image' | 'wav' | 'video' | null {
  if (native || !file.size || file.size > MAX_UPLOAD) return null;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  // Animated GIFs, icons, stickers, videos recorded by Connect and compressed audio
  // retain their original codecs, transparency, animation and metadata.
  if (/^sticker-\d+\./.test(name) || /^connect-video-note-\d+\./.test(name)) return null;
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')
    return file.size >= IMAGE_MIN ? 'image' : null;
  if ((type === 'audio/wav' || type === 'audio/wave' || type === 'audio/x-wav' || /\.wav$/.test(name)) && file.size >= WAV_MIN && file.size <= WAV_MAX)
    return 'wav';
  if (type.startsWith('video/') && file.size >= VIDEO_MIN) return 'video';
  return null;
}
function useful(candidate: Blob, original: File, minimumSaved = 0.12): boolean {
  return candidate.size > 0 && candidate.size <= MAX_UPLOAD && candidate.size <= original.size * (1 - minimumSaved);
}
function mediaFilename(name: string, ext: string): string {
  return (name.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_').slice(0,175) || 'media') + '.' + ext;
}
function bounded<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(Error('Media operation timeout')),ms);
    task.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
}
function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), mime, quality));
}
async function optimizeImage(original: File): Promise<File> {
  const url = URL.createObjectURL(original);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') await bounded(img.decode(),12000);
    else await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(Error('Фото не декодировано')); });
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 40_000_000) return original;
    const scale = Math.min(1, MAX_CANVAS_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // WebP preserves PNG transparency, while JPEG remains widely compatible.
    const mime = 'image/webp';
    const blob = await bounded(toBlob(canvas, mime, .86), 12000);
    if (!blob || blob.type !== mime || !useful(blob, original)) return original;
    return new File([blob], mediaFilename(original.name, 'webp'), {type:mime,lastModified:original.lastModified});
  } finally { URL.revokeObjectURL(url); }
}

function audioRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  // Require an explicit AAC encoder for iPhone/Android playback. MP4 containing
  // Opus may be produced by some other browsers and is intentionally rejected.
  return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4;codecs="mp4a.40.2"']
    .find(mime => MediaRecorder.isTypeSupported(mime)) || null;
}
function bufferRms(buffer: AudioBuffer): number {
  const samples = Math.min(8192, buffer.length);
  let sum = 0, count = 0;
  for(let ch=0;ch<buffer.numberOfChannels;ch++) {
    const data = buffer.getChannelData(ch), skip=Math.max(1,Math.floor(buffer.length/samples));
    for(let i=0;i<data.length;i+=skip) { sum += data[i] * data[i]; count++; }
  }
  return Math.sqrt(sum / Math.max(1,count));
}
async function optimizeWav(original: File): Promise<File> {
  const mime = audioRecorderMime();
  if (!mime || typeof AudioContext === 'undefined') return original;
  const context = new AudioContext();
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  try {
    const buffer = await context.decodeAudioData(await original.arrayBuffer());
    if (!buffer.length || buffer.duration > 65 || buffer.duration < 1 || buffer.numberOfChannels > 2) return original;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    stream = destination.stream;
    recorder = new MediaRecorder(stream, {mimeType:mime,audioBitsPerSecond:64_000});
    const chunks: Blob[] = [];
    const record = recorder;
    const finished = new Promise<Blob>((resolve,reject) => {
      const timeout = window.setTimeout(() => reject(Error('Audio timeout')), Math.min(90000,buffer.duration * 1500 + 7000));
      record.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      record.onerror = () => { window.clearTimeout(timeout); reject(Error('Audio recorder error')); };
      record.onstop = () => { window.clearTimeout(timeout); resolve(new Blob(chunks,{type:'audio/mp4'})); };
    });
    await bounded(context.resume(),8000);
    if (context.state !== 'running') return original;
    record.start(500);
    source.onended = () => { if (record.state !== 'inactive') record.stop(); };
    source.start();
    const candidate = await finished;
    if (!useful(candidate,original,.20)) return original;
    // Avoid silent outputs: Safari can occasionally record an empty/silent track.
    const decoded = await context.decodeAudioData(await candidate.arrayBuffer());
    if (decoded.duration < buffer.duration * .90 || decoded.duration > buffer.duration * 1.1) return original;
    if (bufferRms(buffer) > .008 && bufferRms(decoded) < .003) return original;
    return new File([candidate],mediaFilename(original.name,'m4a'),{type:'audio/mp4',lastModified:original.lastModified});
  } finally {
    if (recorder?.state === 'recording') { try {recorder.stop();} catch {} }
    stream?.getTracks().forEach(t=>t.stop());
    await context.close().catch(()=>{});
  }
}

function videoRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  // An explicit MP4/H.264/AAC claim is mandatory. Chromium's generic MP4 recorder
  // may emit Opus-in-MP4, which is not a safe iPhone recipient format.
  return ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/mp4;codecs=avc1.42E01E,mp4a.40.2']
    .find(mime => MediaRecorder.isTypeSupported(mime)) || null;
}
async function waitMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1) return;
  await new Promise<void>((resolve,reject)=>{
    const timeout=window.setTimeout(()=>done(Error('video timeout')),12000);
    const done=(error?:Error)=>{window.clearTimeout(timeout);video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',fail);error?reject(error):resolve();};
    const ok=()=>done(),fail=()=>done(Error('video metadata'));
    video.addEventListener('loadedmetadata',ok);video.addEventListener('error',fail);
  });
}
/** Browser-capability-gated real-time compression. No codec proof => leave original.
 * In particular, current iOS PWA capabilities must be validated on a real device.
 */
async function optimizeVideo(original: File, onProgress?: (fraction:number)=>void): Promise<File> {
  const mime=videoRecorderMime();
  if (!mime || typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function' || typeof AudioContext === 'undefined') return original;
  let video:HTMLVideoElement|null=null, media:MediaStream|null=null, context:AudioContext|null=null, recorder:MediaRecorder|null=null;
  let url:string|null=null, frame=0, interval:number|null=null, timeout:number|null=null;
  try {
    video=document.createElement('video');
    video.playsInline=true;video.preload='auto';video.volume=1;
    video.style.cssText='position:fixed;left:-200px;top:0;width:4px;height:4px;pointer-events:none;opacity:0';
    document.body.appendChild(video);
    url=URL.createObjectURL(original);video.src=url;video.load();
    await waitMetadata(video);
    const duration=video.duration;
    if (!Number.isFinite(duration) || duration<1 || duration>VIDEO_MAX_SECONDS || !video.videoWidth || !video.videoHeight) return original;
    const scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(2,2*Math.floor(video.videoWidth*scale/2));
    canvas.height=Math.max(2,2*Math.floor(video.videoHeight*scale/2));
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return original;
    const frameStream=canvas.captureStream(24);
    context=new AudioContext();
    const source=context.createMediaElementSource(video);
    const destination=context.createMediaStreamDestination();
    source.connect(destination); // no connection to speakers
    const analyser=context.createAnalyser();
    analyser.fftSize=2048;
    source.connect(analyser);
    const inputSamples=new Float32Array(analyser.fftSize);
    let inputAudioPeak=0;
    media=new MediaStream([...frameStream.getVideoTracks(),...destination.stream.getAudioTracks()]);
    if (media.getVideoTracks().length!==1 || media.getAudioTracks().length!==1) return original;
    await bounded(context.resume(),8000);if(context.state!=='running')return original;
    const expectedSize=duration*(1_100_000+96_000)/8;
    if(expectedSize>=original.size*.86)return original;
    const chunks:Blob[]=[];
    const targetBitrate=Math.round(Math.min(3_200_000,Math.max(900_000,2_600_000*Math.pow((canvas.width*canvas.height)/(1600*900),.7))));
    recorder=new MediaRecorder(media,{mimeType:mime,videoBitsPerSecond:targetBitrate,audioBitsPerSecond:96_000});
    const rec=recorder;
    const finished=new Promise<Blob>((resolve,reject)=>{
      const stop=()=>resolve(new Blob(chunks,{type:'video/mp4'}));
      rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      rec.onstop=stop;rec.onerror=()=>reject(Error('video record error'));
    });
    void finished.catch(()=>{}); // Recorder can fail before playback completes.
    const draw=()=>{if(video && !video.paused && video.readyState>=2)try{ctx.drawImage(video,0,0,canvas.width,canvas.height)}catch{}frame=requestAnimationFrame(draw);};
    draw();rec.start(1000);
    const playback= new Promise<void>((resolve,reject)=>{
      video!.onended=()=>resolve();video!.onerror=()=>reject(Error('video playback error'));
      timeout=window.setTimeout(()=>reject(Error('video encoding timeout')),Math.min(280000,(duration+10)*1700));
      interval=window.setInterval(()=>{
        if(document.visibilityState==='hidden'){reject(Error('background'));return;}
        analyser.getFloatTimeDomainData(inputSamples);
        let sum=0;for(let i=0;i<inputSamples.length;i++)sum+=inputSamples[i]*inputSamples[i];
        inputAudioPeak=Math.max(inputAudioPeak,Math.sqrt(sum/inputSamples.length));
        onProgress?.(Math.min(.99,video!.currentTime/duration));
      },700);
    });
    await bounded(video.play(), 10000);
    await playback;
    rec.stop();
    const output=await bounded(finished, 10000);
    if(!useful(output,original,.15))return original;
    // A media container can have an audio track yet carry silence. Require detectable
    // source audio AND successfully decoded audio on the compressed candidate.
    // Reject instead of silently breaking voice/soundtrack on any unsupported browser.
    if(inputAudioPeak < .004) return original;
    let decodedAudio:AudioBuffer;
    try { decodedAudio=await context.decodeAudioData(await output.arrayBuffer()); }
    catch { return original; }
    if(decodedAudio.duration < duration*.90 || bufferRms(decodedAudio) < .002) return original;
    // Video-level automated verification is not a replacement for actual iOS testing.
    // Reject recordings with implausibly short duration or playback decode failure.
    const probe=document.createElement('video');probe.preload='metadata';probe.playsInline=true;
    const outputUrl=URL.createObjectURL(output);
    try{probe.src=outputUrl;probe.load();await waitMetadata(probe);
      if(!Number.isFinite(probe.duration) || probe.duration<duration*.90 || probe.duration>duration*1.1)return original;
    }finally{probe.removeAttribute('src');probe.load();URL.revokeObjectURL(outputUrl);}
    onProgress?.(1);
    return new File([output],mediaFilename(original.name,'mp4'),{type:'video/mp4',lastModified:original.lastModified});
  } finally {
    if(frame)cancelAnimationFrame(frame);
    if(interval!==null)window.clearInterval(interval);
    if(timeout!==null)window.clearTimeout(timeout);
    if(recorder?.state==='recording')try{recorder.stop()}catch{}
    media?.getTracks().forEach(t=>t.stop());
    if(context)await context.close().catch(()=>{});
    if(video){video.pause();video.removeAttribute('src');video.load();video.remove();}
    if(url)URL.revokeObjectURL(url);
  }
}

export async function connectOptimizeMedia(
  file: File,
  options:{native?:boolean;onProgress?:(fraction:number)=>void}={}
):Promise<ConnectMediaResult> {
  const mode=connectCanOptimizeMedia(file,options.native);
  if(!mode)return {file,decision:'unchanged'};
  try {
    // Never allow failed compression to interrupt the existing upload pipeline.
    const candidate=mode==='image'?await optimizeImage(file):mode==='wav'?await optimizeWav(file):await optimizeVideo(file,options.onProgress);
    return {file:candidate,decision:candidate===file?'unsupported':'optimized'};
  }catch{return {file,decision:'failed'};}
}
