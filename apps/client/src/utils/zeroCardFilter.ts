export type ZeroCardFilterOptions = {
  contrast?: number;
  edgeStrength?: number;
  noise?: number;
  posterize?: boolean;
};

export const ZERO_CARD_FILTER_VERSION = "v4-physical-raptor-tune";

const DEFAULT_OPTIONS: Required<ZeroCardFilterOptions> = {
  contrast: 1.34,
  edgeStrength: 0.68,
  noise: 5,
  posterize: true,
};

type NormalizedRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const MASKS = {
  topHeader: { x: 0.045, y: 0.032, w: 0.91, h: 0.112 },
  statBoxes: { x: 0.06, y: 0.058, w: 0.54, h: 0.08 },
  spdBox: { x: 0.63, y: 0.058, w: 0.15, h: 0.08 },
  mainArtWindow: { x: 0.06, y: 0.14, w: 0.89, h: 0.48 },
  leftIconColumn: { x: 0.04, y: 0.61, w: 0.11, h: 0.26 },
  rarityIcon: { x: 0.042, y: 0.71, w: 0.1, h: 0.12 },
  creatureTypeIcon: { x: 0.045, y: 0.62, w: 0.1, h: 0.1 },
  modifierCircle: { x: 0.84, y: 0.635, w: 0.125, h: 0.125 },
  attackBand: { x: 0.035, y: 0.61, w: 0.93, h: 0.09 },
  effectTextBox: { x: 0.16, y: 0.7, w: 0.79, h: 0.175 },
  footer: { x: 0.035, y: 0.92, w: 0.93, h: 0.06 },
  bottomFlavorOrEmptyBox: { x: 0.04, y: 0.88, w: 0.92, h: 0.04 },
} as const satisfies Record<string, NormalizedRect>;

function inRect(nx: number, ny: number, rect: NormalizedRect): boolean {
  return nx >= rect.x && nx <= rect.x + rect.w && ny >= rect.y && ny <= rect.y + rect.h;
}

function clamp255(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }
function luminance(r: number, g: number, b: number): number { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function rgbToHsl(rInput: number, gInput: number, bInput: number): { h: number; s: number; l: number } {
  const r = rInput / 255; const g = gInput / 255; const b = bInput / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

const isYellowGoldHue = (h: number, s: number, l: number): boolean => h >= 30 && h <= 62 && s > 0.16 && l > 0.15;
const isRedAccentHue = (h: number, s: number, l: number): boolean => (h < 18 || h > 345) && s > 0.34 && l > 0.14;
const hashNoise = (x: number, y: number): number => ((((Math.imul(Math.imul(x, 374761393) ^ Math.imul(y, 668265263), 1274126177) >>> 0) & 0xffff) / 0xffff) - 0.5);

function posterizeTone(value: number): number {
  const palette = [18, 34, 54, 78, 106, 138, 172, 206, 234];
  return palette.reduce((best, t) => Math.abs(t - value) < Math.abs(best - value) ? t : best, palette[0]);
}

function sobelAt(luma: Float32Array, width: number, height: number, x: number, y: number): number {
  if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return 0;
  const s = (sx: number, sy: number): number => luma[sy * width + sx] ?? 0;
  const tl = s(x - 1, y - 1), t = s(x, y - 1), tr = s(x + 1, y - 1), l = s(x - 1, y), r = s(x + 1, y), bl = s(x - 1, y + 1), b = s(x, y + 1), br = s(x + 1, y + 1);
  const gx = -tl + tr - 2 * l + 2 * r - bl + br; const gy = -tl - 2 * t - tr + bl + 2 * b + br;
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

  for (let y = 0; y < height; y += 1) {
    const ny = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = width <= 1 ? 0 : x / (width - 1);
      const idx = (y * width + x) * 4;
      const r = original[idx] ?? 0; const g = original[idx + 1] ?? 0; const b = original[idx + 2] ?? 0; const a = original[idx + 3] ?? 255;
      if (a === 0) continue;
      const { h, s, l } = rgbToHsl(r, g, b);
      const baseLuma = luma[y * width + x] ?? 0;

      const inMainArt = inRect(nx, ny, MASKS.mainArtWindow);
      const inTopHeader = inRect(nx, ny, MASKS.topHeader);
      const inStatBoxes = inRect(nx, ny, MASKS.statBoxes) || inRect(nx, ny, MASKS.spdBox);
      const inAttackBand = inRect(nx, ny, MASKS.attackBand);
      const inEffectTextBox = inRect(nx, ny, MASKS.effectTextBox);
      const inFooter = inRect(nx, ny, MASKS.footer) || inRect(nx, ny, MASKS.bottomFlavorOrEmptyBox);
      const inLeftIcons = inRect(nx, ny, MASKS.leftIconColumn) || inRect(nx, ny, MASKS.rarityIcon) || inRect(nx, ny, MASKS.creatureTypeIcon);
      const inModifierCircle = inRect(nx, ny, MASKS.modifierCircle);

      const preserveUi = inTopHeader || inStatBoxes || inAttackBand || inEffectTextBox || inFooter;

      if (inModifierCircle && (isRedAccentHue(h, s, l) || (s > 0.2 && baseLuma < 150))) {
        const t = clamp255(Math.min(56, baseLuma * 0.46)); data[idx] = t; data[idx + 1] = t; data[idx + 2] = t; continue;
      }

      if (!preserveUi && !inMainArt && !inLeftIcons && (isRedAccentHue(h, s, l) || (s > 0.26 && h <= 28 && l > 0.12))) {
        const t = clamp255(Math.min(52, baseLuma * 0.42)); data[idx] = t; data[idx + 1] = t; data[idx + 2] = t; continue;
      }

      if (preserveUi && isYellowGoldHue(h, s, l)) {
        data[idx] = clamp255(r * 0.98 + 2); data[idx + 1] = clamp255(g * 0.92 + 2); data[idx + 2] = clamp255(b * 0.72); continue;
      }

      if (inMainArt) {
        let tone = (baseLuma - 128) * options.contrast + 128;
        tone -= Math.min(52, sobelAt(luma, width, height, x, y) * options.edgeStrength);
        tone -= Math.max(0, Math.min(1, Math.sqrt(((nx - 0.5) / 0.52) ** 2 + ((ny - 0.39) / 0.54) ** 2)) ) * 10;
        tone += hashNoise(x, y) * options.noise;
        if (options.posterize) tone = posterizeTone(tone);
        const finalTone = clamp255(tone);
        data[idx] = finalTone; data[idx + 1] = finalTone; data[idx + 2] = finalTone; continue;
      }

      if (preserveUi) {
        if (baseLuma < 145) {
          const ink = clamp255(baseLuma * 0.5); data[idx] = ink; data[idx + 1] = ink; data[idx + 2] = ink;
        }
        continue;
      }

      if (!inLeftIcons && s > 0.25) {
        const t = clamp255((baseLuma - 128) * 1.08 + 128); data[idx] = t; data[idx + 1] = t; data[idx + 2] = t;
      }
    }
  }
  return imageData;
}

function drawZeroLogoOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const x = width * 0.112;
  const y = height * 0.173;

  ctx.save();
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.fillStyle = "rgba(236, 230, 210, 0.86)";
  ctx.strokeStyle = "rgba(24, 24, 24, 0.82)";
  ctx.lineWidth = Math.max(1, Math.floor(width * 0.0024));
  ctx.font = `700 italic ${Math.floor(height * 0.045)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeText("Zero", x, y);
  ctx.fillText("Zero", x, y);
  ctx.restore();
}

export async function createZeroCardVariantCanvas(src: string, options?: ZeroCardFilterOptions): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is not available.");
  context.drawImage(image, 0, 0);
  const filtered = applyZeroCardFilter(context.getImageData(0, 0, canvas.width, canvas.height), options);
  context.putImageData(filtered, 0, 0);
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
