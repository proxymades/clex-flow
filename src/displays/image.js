// Images are portable RGBA pixels, decoded once on import rather than on the board.
export const MAX_IMAGE_SIDE = 512;
export const MAX_IMAGE_PIXELS = 65536;
export const MAX_PNG_BYTES = 8 * 1024 * 1024;
const decoded = new WeakMap();

export function encodePixels(pixels) {
  let binary = '';
  for (let i = 0; i < pixels.length; i += 8192) binary += String.fromCharCode(...pixels.subarray(i, i + 8192));
  return btoa(binary);
}
export function imagePixels(image) {
  if (decoded.get(image)?.data === image.data) return decoded.get(image).pixels;
  const binary = atob(image.data), pixels = Uint8ClampedArray.from(binary, char => char.charCodeAt(0));
  decoded.set(image, { data: image.data, pixels });
  return pixels;
}
export function imageIssues(element) {
  const image = element.image;
  if (!image || image.format !== 'rgba8888' || ![image.width, image.height].every(n => Number.isInteger(n) && n >= 1 && n <= MAX_IMAGE_SIDE)) return ['Некорректное изображение.'];
  const size = image.width * image.height * 4;
  if (typeof image.data !== 'string' || image.data.length !== Math.ceil(size / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) return ['Повреждены пиксели изображения.'];
  try { if (imagePixels(image).length !== size) return ['Повреждены пиксели изображения.']; } catch { return ['Повреждены пиксели изображения.']; }
  if (![element.width, element.height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096) || element.width * element.height > MAX_IMAGE_PIXELS) return ['Уменьшите размер изображения.'];
  if (element.mode !== undefined && element.mode !== 'static') return ['Изображение должно быть статическим.'];
  if (element.splash !== undefined && typeof element.splash !== 'boolean') return ['Некорректная настройка заставки.'];
  if (element.splash && (!Number.isInteger(element.durationMs) || element.durationMs < 100 || element.durationMs > 60000)) return ['Время заставки должно быть от 0,1 до 60 секунд.'];
  return [];
}
export function fitImageSize(width, height, maxWidth, maxHeight, upscale = false) {
  const scale = Math.min(upscale ? Infinity : 1, maxWidth / width, maxHeight / height, Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
export function resizeImage(element, axis, value, resolution) {
  const ratio = axis === 'width' ? value / element.image.width : value / element.image.height;
  return fitImageSize(element.image.width * Math.max(0, ratio), element.image.height * Math.max(0, ratio), resolution.width - element.x, resolution.height - element.y, false);
}
export function renderedImage(element) {
  const { width, height, image } = element, source = imagePixels(image);
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Premultiplied interpolation avoids dark/colored halos around transparent PNG edges.
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, Math.min(image.height - 1, (y + 0.5) * image.height / height - 0.5)), y0 = Math.floor(sy), y1 = Math.min(y0 + 1, image.height - 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(image.width - 1, (x + 0.5) * image.width / width - 0.5)), x0 = Math.floor(sx), x1 = Math.min(x0 + 1, image.width - 1), fx = sx - x0;
      const indexes = [(y0 * image.width + x0) * 4, (y0 * image.width + x1) * 4, (y1 * image.width + x0) * 4, (y1 * image.width + x1) * 4];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const alpha = indexes.reduce((sum, i, j) => sum + source[i + 3] * weights[j], 0), target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) rgba[target + channel] = alpha ? indexes.reduce((sum, i, j) => sum + source[i + channel] * source[i + 3] * weights[j], 0) / alpha : 0;
      rgba[target + 3] = alpha;
    }
  }
  const rgb565a8 = new Uint8Array(width * height * 3), alphaOffset = width * height * 2;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4, r = rgba[p] >> 3, g = rgba[p + 1] >> 2, b = rgba[p + 2] >> 3, color = (r << 11) | (g << 5) | b;
    rgb565a8[i * 2] = color & 255; rgb565a8[i * 2 + 1] = color >> 8; rgb565a8[alphaOffset + i] = rgba[p + 3];
    // Match the panel's RGB565 colors in the editor preview.
    rgba[p] = (r << 3) | (r >> 2); rgba[p + 1] = (g << 2) | (g >> 4); rgba[p + 2] = (b << 3) | (b >> 2);
  }
  return { rgba, rgb565a8 };
}
