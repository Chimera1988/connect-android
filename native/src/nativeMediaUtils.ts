import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { Base64 } from 'js-base64';
import { db, mediaUrl } from './backend';

export type MediaKind = 'photos' | 'videos' | 'music';
export type LocalUpload = { uri: string; name: string; mime: string; size?: number };
export type ListedMedia = { path: string; name: string; kind: MediaKind; url: string; size: number };

// Direct mobile upload uses bounded memory until the native resumable uploader is ready.
export const DIRECT_UPLOAD_LIMIT = 20 * 1024 * 1024;
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
  if (size > DIRECT_UPLOAD_LIMIT) return 'Файл больше 20 МБ. Для больших файлов добавим возобновляемую загрузку.';
  return null;
}
export async function uploadFile(bucket: string, path: string, file: LocalUpload): Promise<number> {
  const local = new File(file.uri);
  const size = file.size ?? local.size;
  const errorText = isFileAllowed({...file, size});
  if (errorText) throw new Error(errorText);
  const bytes = await local.arrayBuffer();
  const result = await db.storage.from(bucket).upload(path, bytes, { contentType: file.mime || 'application/octet-stream', upsert: false });
  if (result.error) throw result.error;
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
  return urls.filter((x):x is ListedMedia=>x!==null);
}
