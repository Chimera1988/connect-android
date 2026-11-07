import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { Base64 } from 'js-base64';
import { Upload } from 'tus-js-client';
import { db, mediaUrl } from './backend';

export type MediaKind = 'photos' | 'videos' | 'music';
export type LocalUpload = { uri: string; name: string; mime: string; size?: number };
export type ListedMedia = { path: string; name: string; kind: MediaKind; url: string; size: number };
export type UploadProgress = (sent: number, total: number) => void;

// Expo/RN: standard uploads only for small files. Large uploads stream through TUS.
// The bucket and the project-wide Supabase Storage limit must also permit 100 MB.
export const DIRECT_UPLOAD_LIMIT = 100 * 1024 * 1024;
const STANDARD_UPLOAD_LIMIT = 6 * 1024 * 1024;
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const CONNECT_URL = (process.env.EXPO_PUBLIC_CONNECT_URL || 'https://connect-chat.duckdns.org').replace(/\/$/, '');
export function fileExtension(name: string) { return (name.split('.').pop() || '').toLowerCase(); }
export function nameForStorage(original: string): string {
  const ext = fileExtension(original).replace(/[^a-z0-9]/g, '') || 'dat';
  const normalized = original.replace(/[\r\n]/g, ' ').slice(0, 70);
  let prefix = normalized;
  while (Base64.encode(prefix).length > 118) prefix = prefix.slice(0, -1);
  return `${Date.now()}-${randomUUID()}__${Base64.encodeURI(prefix)}.${ext}`;
}
export function decodedName(storageName: string) {
  const part = storageName.split('__').slice(1).join('__').replace(/\.[^.]*$/, '');
  try { return part ? Base64.decode(part) : storageName; } catch { return storageName; }
}
export function isFileAllowed(file: LocalUpload): string | null {
  const size = file.size ?? new File(file.uri).size;
  if (!size) return 'Пустой файл отправить нельзя';
  if (size > DIRECT_UPLOAD_LIMIT) return 'Файл больше 100 МБ';
  return null;
}
/** Upload to the existing Connect storage buckets. TUS retries failures during the current session.
 * Reopening a terminated app requires reselecting the file; no false promise of disk-persisted uploads.
 */
export async function uploadFile(bucket: string, path: string, file: LocalUpload, onProgress?: UploadProgress): Promise<number> {
  const local = new File(file.uri);
  const size = file.size ?? local.size;
  const errorText = isFileAllowed({...file, size});
  if (errorText) throw new Error(errorText);
  const contentType = file.mime || 'application/octet-stream';
  if (size <= STANDARD_UPLOAD_LIMIT) {
    const bytes = await local.arrayBuffer();
    const result = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
    if (result.error) throw result.error;
    onProgress?.(size,size);
    return size;
  }
  const {data:{session},error:sessionError}=await db.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error('Сессия завершена. Войдите снова.');
  // Use the same Connect HTTPS storage proxy as PWA; do not require VPN to reach
  // the project's direct storage host. Proxy must support TUS PATCH and Location.
  const endpoint = `${CONNECT_URL}/supabase-storage/storage/v1/upload/resumable`;
  await new Promise<void>((resolve,reject)=>{
    const upload = new Upload({uri:file.uri,name:file.name,type:contentType,size} as any,{
      endpoint,
      retryDelays:[0,2500,5000,10000,20000],
      headers:{authorization:`Bearer ${session.access_token}`,'x-upsert':'false'},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      chunkSize:TUS_CHUNK_SIZE,
      metadata:{bucketName:bucket,objectName:path,contentType},
      onProgress:(sent,total)=>onProgress?.(sent,total),
      onError:reject,
      onSuccess:()=>resolve(),
    });
    upload.start();
  });
  onProgress?.(size,size);
  return size;
}
export async function signedObject(bucket: string, path: string) {
  const result = await db.storage.from(bucket).createSignedUrl(path, 3600);
  return result.data?.signedUrl ? mediaUrl(result.data.signedUrl) : null;
}
export async function listMedia(ownerId: string, kind: MediaKind): Promise<ListedMedia[]> {
  const result = await db.storage.from('connect-profile-media').list(`${ownerId}/${kind}`,{
    limit: 100, sortBy: {column: 'created_at', order: 'desc'},
  });
  if (result.error) throw result.error;
  const rows = (result.data || []).filter(x=>x.id && !x.name.startsWith('.'));
  const urls = await Promise.all(rows.map(async row => {
    const path = `${ownerId}/${kind}/${row.name}`;
    const url = await signedObject('connect-profile-media',path);
    return url ? {path,name:decodedName(row.name),kind,url,size: Number(row.metadata?.size || 0)} : null;
  }));
  return urls.filter((x): x is ListedMedia=>x!==null);
}
