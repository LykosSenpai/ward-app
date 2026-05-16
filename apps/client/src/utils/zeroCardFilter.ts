export type ZeroCardFilterOptions = {
  contrast?: number;
  edgeStrength?: number;
  noise?: number;
  posterize?: boolean;
};

export const ZERO_CARD_FILTER_VERSION = "v2-region-aware";

const DEFAULT_OPTIONS: Required<ZeroCardFilterOptions> = {
  contrast: 1.48,
  edgeStrength: 0.82,
  noise: 8,
  posterize: true,
};

<<<<<<< ours
function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbToHsl(
  rInput: number,
  gInput: number,
  bInput: number,
): { h: number; s: number; l: number } {
  const r = rInput / 255;
  const g = gInput / 255;
  const b = bInput / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;

  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }

  return {
    h: h * 60,
    s,
    l,
  };
}

function isArtRegion(nx: number, ny: number): boolean {
  return nx > 0.055 && nx < 0.955 && ny > 0.132 && ny < 0.64;
}

function isGoldUiRegion(nx: number, ny: number): boolean {
  const topHeader = ny > 0.035 && ny < 0.148 && nx > 0.04 && nx < 0.965;
  const attackBand = ny > 0.608 && ny < 0.782 && nx > 0.035 && nx < 0.965;
  const bottomTextBox = ny > 0.758 && ny < 0.965 && nx > 0.04 && nx < 0.955;

  return topHeader || attackBand || bottomTextBox;
}

function isSideGoldUiRegion(nx: number, ny: number): boolean {
  const leftCreatureRail = nx > 0.032 && nx < 0.18 && ny > 0.132 && ny < 0.66;
  const rightCombatRail = nx > 0.885 && nx < 0.966 && ny > 0.57 && ny < 0.815;

  return leftCreatureRail || rightCombatRail;
}

function isTypeIconRegion(nx: number, ny: number): boolean {
  const dx = (nx - 0.118) / 0.078;
  const dy = (ny - 0.205) / 0.076;

  return dx * dx + dy * dy <= 1;
}

function isOuterFrame(nx: number, ny: number): boolean {
  return nx < 0.047 || nx > 0.953 || ny < 0.025 || ny > 0.977;
}

function isFrameBand(nx: number, ny: number): boolean {
  return nx < 0.072 || nx > 0.928 || ny < 0.075 || ny > 0.936;
}

function isYellowGoldHue(h: number, s: number, l: number): boolean {
  return h >= 32 && h <= 58 && s > 0.18 && l > 0.18;
}

function isRedAccentHue(h: number, s: number, l: number): boolean {
  return (h < 18 || h > 345) && s > 0.28 && l > 0.08;
}

function hashNoise(x: number, y: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
=======
type NormalizedRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};
>>>>>>> theirs

const MASKS = {
  outerFrame: { x: 0, y: 0, w: 1, h: 1 },
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
  const palette = [12, 28, 46, 68, 96, 130, 168, 208, 238];
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

<<<<<<< ours
      const inArt = isArtRegion(nx, ny);
      const inGoldUi = isGoldUiRegion(nx, ny);
      const inSideGoldUi = isSideGoldUiRegion(nx, ny);
      const inTypeIcon = isTypeIconRegion(nx, ny);
      const inFrameBand = isFrameBand(nx, ny);
      const inOuterFrame = isOuterFrame(nx, ny);

      const isRedAccent = isRedAccentHue(h, s, l);
      const isYellowGold = isYellowGoldHue(h, s, l);

      if (inTypeIcon && s > 0.08 && baseLuma > 34) {
        data[index] = r;
        data[index + 1] = g;
        data[index + 2] = b;
        data[index + 3] = a;
        continue;
      }

      // Keep the yellow/gold card UI panels recognizable before frame replacement.
      // These panels touch the top/bottom frame masks, so handle them first to avoid clipping their edges.
      if ((inGoldUi || inSideGoldUi) && isYellowGold) {
        data[index] = clamp255(r * 1.02 + 4);
        data[index + 1] = clamp255(g * 0.96 + 5);
        data[index + 2] = clamp255(b * 0.72);
        data[index + 3] = a;
        continue;
      }

      // Red frame / regular-card red accents become black in the Zero variant.
      // Do not do this inside the art area; red/orange art backgrounds should become grayscale, not solid black.
      if (!inArt && !inGoldUi && !inSideGoldUi && (isRedAccent || inOuterFrame || (inFrameBand && s > 0.16))) {
        const frameTone = inOuterFrame ? 12 : baseLuma > 75 ? 20 : Math.max(12, baseLuma * 0.25);

        data[index] = clamp255(frameTone);
        data[index + 1] = clamp255(frameTone);
        data[index + 2] = clamp255(frameTone);
        data[index + 3] = inFrameBand ? Math.max(a, 245) : a;
        continue;
      }

      let tone = (baseLuma - 128) * (inArt ? options.contrast : 1.12) + 128;

      if (inArt) {
        const edge = Math.min(68, sobelAt(luma, width, height, x, y) * options.edgeStrength);
        tone -= edge;

        const dx = (nx - 0.5) / 0.52;
        const dy = (ny - 0.38) / 0.54;
        const vignette = Math.max(0, Math.min(1, Math.sqrt(dx * dx + dy * dy)));
=======
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
        const t = clamp255(Math.min(38, baseLuma * 0.35)); data[idx] = t; data[idx + 1] = t; data[idx + 2] = t; continue;
      }

      if (!preserveUi && !inMainArt && !inLeftIcons && (isRedAccentHue(h, s, l) || (s > 0.26 && h <= 28 && l > 0.12))) {
        const t = clamp255(Math.min(30, baseLuma * 0.28)); data[idx] = t; data[idx + 1] = t; data[idx + 2] = t; continue;
      }

      if (preserveUi && isYellowGoldHue(h, s, l)) {
        data[idx] = clamp255(r * 1.03 + 5); data[idx + 1] = clamp255(g * 0.97 + 4); data[idx + 2] = clamp255(b * 0.7); continue;
      }
>>>>>>> theirs

      if (inMainArt) {
        let tone = (baseLuma - 128) * options.contrast + 128;
        tone -= Math.min(78, sobelAt(luma, width, height, x, y) * options.edgeStrength);
        tone -= Math.max(0, Math.min(1, Math.sqrt(((nx - 0.5) / 0.52) ** 2 + ((ny - 0.39) / 0.54) ** 2)) ) * 20;
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
  const x = width * 0.06; const y = height * 0.14; const w = width * 0.19; const h = height * 0.058;
  ctx.save();
  ctx.fillStyle = "rgba(8,8,8,0.86)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(222, 189, 95, 0.9)";
  ctx.lineWidth = Math.max(1, Math.floor(width * 0.003));
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#f0d27f";
  ctx.font = `${Math.floor(height * 0.033)}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText("ZERO", x + w * 0.14, y + h * 0.52);
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
