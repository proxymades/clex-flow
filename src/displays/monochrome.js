export const isMonochrome = display => display.colorFormats.includes('I1');

export function monochromePixel(color) {
  const rgb = Number.parseInt(color.slice(1), 16);
  // Match the firmware's luminance threshold after LVGL packs RGB565.
  const red = Math.floor(((rgb >> 19) & 31) * 255 / 31);
  const green = Math.floor(((rgb >> 10) & 63) * 255 / 63);
  const blue = Math.floor(((rgb >> 3) & 31) * 255 / 31);
  return red * 2126 + green * 7152 + blue * 722 >= 1280000 ? '#ffffff' : '#000000';
}
