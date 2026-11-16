/** CONNECT_PWA_STICKER_WEBP_EDITOR_20261115
 * Convert still PNG/JPEG to transparent-friendly WebP *before* uploading.
 * GIFs and existing WebP files retain their bytes and possible animation.
 */
const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_STICKER_INPUT = 12 * 1024 * 1024;
const MAX_STICKER_SIDE = 512;

export async function prepareStickerFile(file: File, serverFallback?: (source: File) => Promise<Blob>): Promise<File> { // CONNECT_PWA_STICKER_SAFARI_WEBP_FALLBACK_FIX3_20261115
  const extension = file.name.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/)?.[1];
  const detected = file.type.toLowerCase();
  const mime = detected === 'image/jpg' ? 'image/jpeg' : detected || (
    extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' :
    extension === 'png' ? 'image/png' :
    extension === 'webp' ? 'image/webp' :
    extension === 'gif' ? 'image/gif' : ''
  );
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
    throw new Error('Поддерживаются JPG, PNG, WebP и GIF');
  }
  if (file.size <= 0 || file.size > MAX_STICKER_INPUT) {
    throw new Error('Исходное изображение должно быть до 12 МБ');
  }
  // Never flatten animations during optimization.
  if (mime === 'image/gif' || mime === 'image/webp') {
    if (file.size > MAX_STICKER_BYTES) throw new Error('GIF и WebP должны быть не больше 2 МБ');
    if (file.type === mime) return file;
    return new File([file], file.name, { type: mime, lastModified: file.lastModified });
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error('Изображение слишком большое или повреждено');
    }
    const scale = Math.min(1, MAX_STICKER_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Нет поддержки обработки изображения');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // Alpha remains transparent; do not paint an opaque background.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Safari may silently encode PNG even when toBlob was asked for WebP.
    // Validate the actual RIFF/WEBP file signature, not only the reported MIME.
    async function isValidWebP(value: Blob | null): Promise<boolean> {
      if (!value || value.type !== 'image/webp' || value.size < 12 || value.size > MAX_STICKER_BYTES) return false;
      const header = new Uint8Array(await value.slice(0, 12).arrayBuffer());
      return String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
        String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    }
    let blob: Blob | null = null;
    try {
      blob = await new Promise<Blob | null>((resolve, reject) => {
        try { canvas.toBlob(resolve, 'image/webp', 0.9); }
        catch (error) { reject(error); }
      });
    } catch { /* Native encoder unsupported; try the authenticated server fallback. */ }
    if (!(await isValidWebP(blob))) {
      if (!serverFallback) throw new Error('Браузер не поддерживает WebP: нужна серверная конвертация');
      blob = await serverFallback(file);
    }
    if (!(await isValidWebP(blob))) {
      throw new Error('Сервер не вернул корректный WebP до 2 МБ');
    }
    if (!blob) throw new Error('WebP файл отсутствует'); // Type-safe after validation.
    const filename = (file.name.replace(/\.[^.]+$/, '') || 'sticker') + '.webp';
    return new File([blob], filename, { type: 'image/webp', lastModified: file.lastModified });
  } finally {
    URL.revokeObjectURL(url);
  }
}
