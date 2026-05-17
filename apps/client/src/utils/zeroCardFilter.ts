export type ZeroCardFilterOptions = {
  contrast?: number;
  edgeStrength?: number;
  noise?: number;
  posterize?: boolean;
  textureOpacity?: number;
};

export const ZERO_CARD_FILTER_VERSION = "v7-bounds-aware-scaling";

const DEFAULT_OPTIONS: Required<ZeroCardFilterOptions> = {
  contrast: 1.28,
  edgeStrength: 0.62,
  noise: 4,
  posterize: true,
  textureOpacity: 0.08,
};

type NormalizedRect = { x: number; y: number; w: number; h: number };
type CardBounds = { left: number; top: number; right: number; bottom: number };

function detectCardBounds(original: Uint8ClampedArray, width: number, height: number): CardBounds {
  const darkThreshold = 58;
  const minDarkPerLine = Math.max(4, Math.floor(width * 0.03));

  const rowDarkCount = (y: number): number => {
    let dark = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const red = original[i] ?? 0;
      const green = original[i + 1] ?? 0;
      const blue = original[i + 2] ?? 0;
      if (red < darkThreshold && green < darkThreshold && blue < darkThreshold) dark += 1;
    }
    return dark;
  };

  const colDarkCount = (x: number): number => {
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4;
      const red = original[i] ?? 0;
      const green = original[i + 1] ?? 0;
      const blue = original[i + 2] ?? 0;
      if (red < darkThreshold && green < darkThreshold && blue < darkThreshold) dark += 1;
    }
    return dark;
  };

  let left = 0;
  while (left < width * 0.16 && colDarkCount(left) > height * 0.65) left += 1;

  let right = width - 1;
  while (right > width * 0.84 && colDarkCount(right) > height * 0.65) right -= 1;

  let top = 0;
  while (top < height * 0.12 && rowDarkCount(top) > minDarkPerLine) top += 1;

  let bottom = height - 1;
  while (bottom > height * 0.88 && rowDarkCount(bottom) > minDarkPerLine) bottom -= 1;

  if (right - left < width * 0.7 || bottom - top < height * 0.8) {
    return { left: 0, top: 0, right: width - 1, bottom: height - 1 };
  }

  return { left, top, right, bottom };
}

// Coordinates tuned to the 1060x1484 template, normalized for same-layout cards.
const MASKS = {
  protectedIconArea: { x: 0.025, y: 0.575, w: 0.14, h: 0.315 },
  topHeader: { x: 0.04, y: 0.03, w: 0.92, h: 0.115 },
  statBoxes: { x: 0.55, y: 0.04, w: 0.39, h: 0.1 },
  mainArtWindow: { x: 0.073, y: 0.145, w: 0.858, h: 0.454 },
  modifierCircle: { x: 0.845, y: 0.625, w: 0.12, h: 0.13 },
  attackBand: { x: 0.06, y: 0.61, w: 0.88, h: 0.09 },
  effectTextBox: { x: 0.08, y: 0.705, w: 0.86, h: 0.175 },
  footer: { x: 0.04, y: 0.92, w: 0.92, h: 0.06 },
} as const satisfies Record<string, NormalizedRect>;

const inRect = (nx: number, ny: number, rect: NormalizedRect): boolean =>
  nx >= rect.x && nx <= rect.x + rect.w && ny >= rect.y && ny <= rect.y + rect.h;
const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
const luminance = (red: number, green: number, blue: number): number => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

function rgbToHsl(redInput: number, greenInput: number, blueInput: number): { h: number; s: number; l: number } {
  const red = redInput / 255;
  const green = greenInput / 255;
  const blue = blueInput / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: lightness };

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;

  return { h: hue * 60, s: saturation, l: lightness };
}

const isYellowGoldHue = (hue: number, saturation: number, lightness: number): boolean =>
  hue >= 30 && hue <= 64 && saturation > 0.14 && lightness > 0.16;
const isRedAccentHue = (hue: number, saturation: number, lightness: number): boolean =>
  (hue <= 20 || hue >= 342) && saturation > 0.3 && lightness > 0.1;
const hashNoise = (x: number, y: number): number =>
  ((((Math.imul(Math.imul(x, 374761393) ^ Math.imul(y, 668265263), 1274126177) >>> 0) & 0xffff) / 0xffff) - 0.5);

function posterizeTone(value: number): number {
  const palette = [22, 38, 56, 78, 104, 134, 168, 202, 232];
  return palette.reduce((best, tone) => Math.abs(tone - value) < Math.abs(best - value) ? tone : best, palette[0]);
}

function sobelAt(luma: Float32Array, width: number, height: number, x: number, y: number): number {
  if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return 0;

  const sample = (sx: number, sy: number): number => luma[sy * width + sx] ?? 0;
  const topLeft = sample(x - 1, y - 1);
  const top = sample(x, y - 1);
  const topRight = sample(x + 1, y - 1);
  const left = sample(x - 1, y);
  const right = sample(x + 1, y);
  const bottomLeft = sample(x - 1, y + 1);
  const bottom = sample(x, y + 1);
  const bottomRight = sample(x + 1, y + 1);
  const gx = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
  const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;

  return Math.sqrt(gx * gx + gy * gy) / 8;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load card image: ${src}`));
    image.crossOrigin = "anonymous";
    image.src = src;
  });
}

export function applyZeroCardFilter(imageData: ImageData, optionsInput: ZeroCardFilterOptions = {}): ImageData {
  const options = { ...DEFAULT_OPTIONS, ...optionsInput };
  const { width, height, data } = imageData;
  const original = new Uint8ClampedArray(data);
  const luma = new Float32Array(width * height);
  for (let i = 0; i < original.length; i += 4) luma[i / 4] = luminance(original[i] ?? 0, original[i + 1] ?? 0, original[i + 2] ?? 0);

  for (let i = 0; i < original.length; i += 4) {
    luma[i / 4] = luminance(original[i] ?? 0, original[i + 1] ?? 0, original[i + 2] ?? 0);
  }

  const bounds = detectCardBounds(original, width, height);
  const boundsW = Math.max(1, bounds.right - bounds.left);
  const boundsH = Math.max(1, bounds.bottom - bounds.top);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = Math.max(0, Math.min(1, (x - bounds.left) / boundsW));
      const ny = Math.max(0, Math.min(1, (y - bounds.top) / boundsH));
      const idx = (y * width + x) * 4;
      const red = original[idx] ?? 0;
      const green = original[idx + 1] ?? 0;
      const blue = original[idx + 2] ?? 0;
      const alpha = original[idx + 3] ?? 255;

      if (alpha === 0) continue;

      const baseLuma = luma[y * width + x] ?? 0;
      const { h: hue, s: saturation, l: lightness } = rgbToHsl(red, green, blue);

      const protectedIcon = inRect(nx, ny, MASKS.protectedIconArea);
      const inMainArt = inRect(nx, ny, MASKS.mainArtWindow);
      const inModifier = inRect(nx, ny, MASKS.modifierCircle);
      const preserveYellowUi =
        inRect(nx, ny, MASKS.topHeader) ||
        inRect(nx, ny, MASKS.statBoxes) ||
        inRect(nx, ny, MASKS.attackBand) ||
        inRect(nx, ny, MASKS.effectTextBox) ||
        inRect(nx, ny, MASKS.footer);

      if (protectedIcon) continue;

      if (inModifier && (isRedAccentHue(hue, saturation, lightness) || (saturation > 0.18 && baseLuma < 175))) {
        const tone = clamp255(Math.min(48, baseLuma * 0.4));
        data[idx] = tone;
        data[idx + 1] = tone;
        data[idx + 2] = tone;
        continue;
      }

      if (!preserveYellowUi && !inMainArt && isRedAccentHue(hue, saturation, lightness)) {
        const tone = clamp255(Math.min(44, baseLuma * 0.38));
        data[idx] = tone;
        data[idx + 1] = tone;
        data[idx + 2] = tone;
        continue;
      }

      if (preserveYellowUi && isYellowGoldHue(hue, saturation, lightness)) {
        data[idx] = clamp255(red * 1.04 + 3);
        data[idx + 1] = clamp255(green * 1.01 + 2);
        data[idx + 2] = clamp255(blue * 0.78);
        continue;
      }

      if (inMainArt) {
        let tone = (baseLuma - 128) * options.contrast + 128;
        tone -= Math.min(44, sobelAt(luma, width, height, x, y) * options.edgeStrength);
        tone -= Math.max(0, Math.min(1, Math.sqrt(((nx - 0.5) / 0.52) ** 2 + ((ny - 0.39) / 0.54) ** 2))) * 8;
        tone += hashNoise(x, y) * options.noise;

        if (options.posterize) tone = posterizeTone(tone);

        const finalTone = clamp255(tone);
        data[idx] = finalTone;
        data[idx + 1] = finalTone;
        data[idx + 2] = finalTone;
      }
    }
  }

  return imageData;
}

function drawZeroLogoOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const x = width * 0.155;
  const y = height * 0.165;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-7 * Math.PI) / 180);
  ctx.font = `700 italic ${Math.floor(height * 0.039)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(26, 26, 26, 0.9)";
  ctx.lineWidth = Math.max(1, Math.floor(width * 0.002));
  ctx.fillStyle = "rgba(229, 228, 220, 0.95)";
  ctx.strokeText("Zero", 0, 0);
  ctx.fillText("Zero", 0, 0);
  ctx.restore();
}

function applyPrintTexture(ctx: CanvasRenderingContext2D, width: number, height: number, opacity: number): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = "multiply";

  for (let i = 0; i < 260; i += 1) {
    const x = (i * 73) % width;
    const y = (i * 151) % height;
    const w = 1 + ((i * 7) % 3);
    const texH = 1 + ((i * 11) % 2);
    ctx.fillStyle = i % 3 === 0 ? "rgba(20,20,20,0.2)" : "rgba(240,240,240,0.15)";
    ctx.fillRect(x, y, w, texH);
  }

  ctx.restore();
}

export async function createZeroCardVariantCanvas(src: string, options?: ZeroCardFilterOptions): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is not available.");

  context.drawImage(image, 0, 0);

  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const filtered = applyZeroCardFilter(context.getImageData(0, 0, canvas.width, canvas.height), mergedOptions);
  context.putImageData(filtered, 0, 0);
  applyPrintTexture(context, canvas.width, canvas.height, mergedOptions.textureOpacity);
  drawZeroLogoOverlay(context, canvas.width, canvas.height);

  return canvas;
}

export async function createZeroCardVariantDataUrl(src: string, options?: ZeroCardFilterOptions): Promise<string> {
  return (await createZeroCardVariantCanvas(src, options)).toDataURL("image/png");
}

export async function createZeroCardVariantBlob(src: string, options?: ZeroCardFilterOptions): Promise<Blob> {
  const canvas = await createZeroCardVariantCanvas(src, options);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Failed to export generated Zero card image.")), "image/png");
  });
}
