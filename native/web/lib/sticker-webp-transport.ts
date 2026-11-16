/** CONNECT_PWA_STICKER_BINARY_TRANSPORT_FIX4_20261115
 * Safari File -> Supabase Functions invoke may result in an empty request body.
 * Send a copied ArrayBuffer over fetch, then verify the returned WebP signature.
 * Credentials stay in memory and are supplied only to the authenticated endpoint.
 */
const SOURCE_LIMIT = 12 * 1024 * 1024;
const OUTPUT_LIMIT = 2 * 1024 * 1024;

type StickerConversionSettings = {
  endpoint: string;
  accessToken: string;
  apiKey: string;
  transport?: typeof fetch;
};

export async function convertStickerWebpOnServer(
  source: File,
  settings: StickerConversionSettings
): Promise<Blob> {
  if (!settings.accessToken || !settings.apiKey) {
    throw new Error('Войдите в Connect, чтобы добавить стикер');
  }
  if (source.size <= 0 || source.size > SOURCE_LIMIT) {
    throw new Error('Файл пуст или его размер превышает 12 МБ');
  }
  // Do not send a File object via functions.invoke(): in the iOS PWA logs,
  // requests arrived with zero bytes. ArrayBuffer is a standard BodyInit.
  const payload = await source.arrayBuffer();
  if (!payload.byteLength || payload.byteLength !== source.size) {
    throw new Error('Не удалось прочитать файл для отправки');
  }
  const send = settings.transport ?? fetch;
  const response = await send(settings.endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + settings.accessToken,
      apikey: settings.apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: payload,
  });
  if (!response.ok) {
    let details = '';
    if ((response.headers.get('Content-Type') || '').includes('application/json')) {
      try {
        const json: unknown = await response.json();
        if (json && typeof json === 'object' && 'error' in json &&
            typeof (json as { error?: unknown }).error === 'string') {
          details = (json as { error: string }).error.slice(0, 180);
        }
      } catch { /* Preserve status and avoid assuming an error response format. */ }
    }
    throw new Error('Серверная конвертация WebP: HTTP ' + response.status +
      (details ? ' — ' + details : ''));
  }
  if (response.headers.get('X-Connect-Media-Type') !== 'image/webp') {
    throw new Error('Сервер не указал корректный формат WebP');
  }
  const output = await response.arrayBuffer();
  if (output.byteLength < 12 || output.byteLength > OUTPUT_LIMIT) {
    throw new Error('Сервер вернул пустой или слишком большой WebP');
  }
  const header = new Uint8Array(output, 0, 12);
  const magic = String.fromCharCode(...header);
  if (!magic.startsWith('RIFF') || magic.slice(8, 12) !== 'WEBP') {
    throw new Error('Сервер вернул повреждённый WebP');
  }
  return new Blob([output], { type: 'image/webp' });
}
