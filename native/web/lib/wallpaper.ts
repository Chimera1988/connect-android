const DB_NAME='connect-personalization';
const STORE='wallpapers';
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function read():Promise<string|null>{const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get('chat');req.onsuccess=()=>resolve(typeof req.result==='string'?req.result:null);req.onerror=()=>reject(req.error);tx.oncomplete=()=>database.close();});}
export async function loadWallpaper():Promise<string|null>{
 try{
  const current=await read();if(current)return current;
  const seeded=(window as Window&{__CONNECT_LEGACY_STORAGE__?:Record<string,string>}).__CONNECT_LEGACY_STORAGE__;
  const legacy=seeded?.['connect-android-legacy-wallpaper']||localStorage.getItem('connect-android-legacy-wallpaper');
  if(!legacy||!/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(legacy))return null;
  const response=await fetch(legacy);const blob=await response.blob();
  const restored=await saveWallpaper(new File([blob],'connect-wallpaper',{type:blob.type}));
  if(seeded)delete seeded['connect-android-legacy-wallpaper'];
  localStorage.removeItem('connect-android-legacy-wallpaper');return restored;
 }catch{return null;}
}
export async function saveWallpaper(file:File):Promise<string>{
 const image=await createImageBitmap(file);
 const scale=Math.min(1,1440/Math.max(image.width,image.height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');ctx.drawImage(image,0,0,canvas.width,canvas.height);image.close();
 const data=canvas.toDataURL('image/jpeg',0.78);
 const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction(STORE,'readwrite');tx.objectStore(STORE).put(data,'chat');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});database.close();return data;
}
export async function clearWallpaper():Promise<void>{try{const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction(STORE,'readwrite');tx.objectStore(STORE).delete('chat');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});database.close();}catch{}}
