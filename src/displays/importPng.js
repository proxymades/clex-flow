import { encodePixels, fitImageSize, MAX_IMAGE_SIDE, MAX_PNG_BYTES } from './image.js';

export async function importPng(file, resolution) {
  if (!file || file.size > MAX_PNG_BYTES) throw new Error('Выберите PNG размером до 8 МБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte) || String.fromCharCode(...bytes.subarray(12,16)) !== 'IHDR') throw new Error('Выберите корректный файл PNG.');
  const header = new DataView(bytes.buffer), width = header.getUint32(16), height = header.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216) throw new Error('Слишком большое изображение. Уменьшите исходный PNG.');
  let bitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); }
  catch { throw new Error('Не удалось прочитать PNG. Файл повреждён или формат не поддерживается.'); }
  try {
    const source = fitImageSize(bitmap.width, bitmap.height, MAX_IMAGE_SIDE, MAX_IMAGE_SIDE);
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, source.width, source.height);
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    const size = fitImageSize(source.width, source.height, Math.min(120, resolution.width), Math.min(96, resolution.height));
    return { id: crypto.randomUUID(), type: 'image', name: file.name.replace(/\.png$/i, '').slice(0,80) || 'Логотип', x: Math.floor((resolution.width - size.width) / 2), y: Math.floor((resolution.height - size.height) / 2), ...size, image: { format: 'rgba8888', ...source, data: encodePixels(pixels) } };
  } finally { bitmap.close(); }
}
