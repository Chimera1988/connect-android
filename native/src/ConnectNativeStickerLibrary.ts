/** Save received keyboard stickers into the private Connect favorites pack.
 * Unlike a signed message URL, this is a durable independent storage copy.
 * The built-in sticker favorites and recent list stay device-local.
 */
import * as Crypto from 'expo-crypto';
import {db} from './backend';
import type {Message} from './backend';

const FAVORITES_PACK='Избранное из чатов · Connect';
const MAX_IMAGE=2*1024*1024;
const recognized=/^sticker-\d+\.(?:png|webp|gif|jpe?g)$/i;

type PackRow={id:string};
export async function saveKeyboardStickerFavorite(message:Message,ownerId:string):Promise<'added'|'exists'>{
  if(!ownerId||!message.attachment_path||message.attachment_kind!=='image'||!recognized.test(message.attachment_name||''))
    throw new Error('Это сообщение не является стикером клавиатуры');
  const result=await db.storage.from('connect-attachments').download(message.attachment_path);
  if(result.error||!result.data)throw result.error||new Error('Не удалось скачать стикер');
  const blob=result.data;
  if(blob.size<1||blob.size>MAX_IMAGE)throw new Error('Стикер должен быть до 2 МБ');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let mime=(message.attachment_type||blob.type||'').toLowerCase();
  if(mime==='image/jpg')mime='image/jpeg';
  if(!['image/png','image/webp','image/gif','image/jpeg'].includes(mime))
    throw new Error('Поддерживаются PNG, WebP, GIF и JPEG');
  const hash=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes);
  const fingerprint=Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,48);
  // The same stable fingerprint identifies repeated images across different messages.
  const name='iOS-'+fingerprint;
  let pack:PackRow|null=null;
  const found=await db.from('connect_sticker_packs').select('id')
    .eq('owner_id',ownerId).eq('name',FAVORITES_PACK).maybeSingle();
  if(found.error)throw found.error;
  if(found.data)pack=found.data as PackRow;
  else{
    const created=await db.from('connect_sticker_packs').insert({owner_id:ownerId,name:FAVORITES_PACK,emoji:'⭐',is_public:false})
      .select('id').single();
    if(created.error||!created.data)throw created.error||new Error('Не удалось создать избранное');
    pack=created.data as PackRow;
  }
  const duplicate=await db.from('connect_stickers').select('id').eq('pack_id',pack.id).eq('name',name).limit(1);
  if(duplicate.error)throw duplicate.error;
  if(duplicate.data?.length)return 'exists';
  const ext=mime==='image/jpeg'?'jpg':mime==='image/gif'?'gif':mime==='image/webp'?'webp':'png';
  const path=`${ownerId}/${pack.id}/${Crypto.randomUUID()}.${ext}`;
  const uploaded=await db.storage.from('connect-stickers').upload(path,bytes,{contentType:mime,upsert:false});
  if(uploaded.error)throw uploaded.error;
  const inserted=await db.from('connect_stickers').insert({pack_id:pack.id,name,storage_path:path});
  if(inserted.error){
    await db.storage.from('connect-stickers').remove([path]).catch(()=>{});
    throw inserted.error;
  }
  return 'added';
}
