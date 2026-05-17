export type ZeroCardFilterOptions = {
  contrast?: number;
  edgeStrength?: number;
  noise?: number;
  posterize?: boolean;
  textureOpacity?: number;
};

export const ZERO_CARD_FILTER_VERSION = "v8-template-mask-layers";

const DEFAULT_OPTIONS: Required<ZeroCardFilterOptions> = {
  contrast: 1.28,
  edgeStrength: 0.62,
  noise: 4,
  posterize: true,
  textureOpacity: 0.08,
};

type NormalizedRect = { x: number; y: number; w: number; h: number };
type CardBounds = { left: number; top: number; right: number; bottom: number };
type MaskPainter = (ctx: CanvasRenderingContext2D, bounds: CardBounds) => void;

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

const TEMPLATE_MASKS = {
  mainArtWindow: { x: 0.035, y: 0.13, w: 0.93, h: 0.49 },
  topHeader: { x: 0.04, y: 0.026, w: 0.92, h: 0.12 },
  statBoxes: { x: 0.55, y: 0.04, w: 0.39, h: 0.1 },
  attackBand: { x: 0.055, y: 0.61, w: 0.89, h: 0.1 },
  effectTextBox: { x: 0.075, y: 0.705, w: 0.87, h: 0.18 },
  footer: { x: 0.035, y: 0.895, w: 0.93, h: 0.08 },
  modifierCircle: { x: 0.833, y: 0.61, w: 0.14, h: 0.13 },
  topLeftTypeAndRarity: { x: 0.02, y: 0.09, w: 0.23, h: 0.065 },
  protectedLeftIcons: { x: 0.02, y: 0.57, w: 0.15, h: 0.32 },
} as const satisfies Record<string, NormalizedRect>;

const YELLOW_UI_RESTORE_RECTS: NormalizedRect[] = [
  TEMPLATE_MASKS.topHeader,
  TEMPLATE_MASKS.statBoxes,
  TEMPLATE_MASKS.attackBand,
  TEMPLATE_MASKS.effectTextBox,
  TEMPLATE_MASKS.footer,
];

const PROTECTED_RESTORE_RECTS: NormalizedRect[] = [
  TEMPLATE_MASKS.topLeftTypeAndRarity,
  TEMPLATE_MASKS.protectedLeftIcons,
];

const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
const luminance = (red: number, green: number, blue: number): number => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
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

function mustGetContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  return context;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function rectToPixels(rect: NormalizedRect, bounds: CardBounds): { x: number; y: number; w: number; h: number } {
  const boundsW = Math.max(1, bounds.right - bounds.left);
  const boundsH = Math.max(1, bounds.bottom - bounds.top);

  return {
    x: bounds.left + rect.x * boundsW,
    y: bounds.top + rect.y * boundsH,
    w: rect.w * boundsW,
    h: rect.h * boundsH,
  };
}

function fillNormalizedRect(ctx: CanvasRenderingContext2D, bounds: CardBounds, rect: NormalizedRect): void {
  const px = rectToPixels(rect, bounds);
  ctx.fillRect(px.x, px.y, px.w, px.h);
}

function fillNormalizedEllipse(ctx: CanvasRenderingContext2D, bounds: CardBounds, rect: NormalizedRect): void {
  const px = rectToPixels(rect, bounds);
  ctx.beginPath();
  ctx.ellipse(px.x + px.w / 2, px.y + px.h / 2, px.w / 2, px.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function createMaskCanvas(width: number, height: number, bounds: CardBounds, painter: MaskPainter): HTMLCanvasElement {
  const mask = createCanvas(width, height);
  const context = mustGetContext(mask);
  context.fillStyle = "#fff";
  painter(context, bounds);
  return mask;
}

function eraseRestoreRegions(ctx: CanvasRenderingContext2D, bounds: CardBounds): void {
  ctx.globalCompositeOperation = "destination-out";

  for (const rect of YELLOW_UI_RESTORE_RECTS) {
    fillNormalizedRect(ctx, bounds, rect);
  }

  for (const rect of PROTECTED_RESTORE_RECTS) {
    fillNormalizedRect(ctx, bounds, rect);
  }

  fillNormalizedEllipse(ctx, bounds, TEMPLATE_MASKS.modifierCircle);
  ctx.globalCompositeOperation = "source-over";
}

function createOuterFrameMask(width: number, height: number, bounds: CardBounds): HTMLCanvasElement {
  return createMaskCanvas(width, height, bounds, (ctx, maskBounds) => {
    const card = rectToPixels({ x: 0, y: 0, w: 1, h: 1 }, maskBounds);

    ctx.fillRect(card.x, card.y, card.w, card.h);
    ctx.globalCompositeOperation = "destination-out";
    fillNormalizedRect(ctx, maskBounds, TEMPLATE_MASKS.mainArtWindow);
    ctx.globalCompositeOperation = "source-over";
    eraseRestoreRegions(ctx, maskBounds);
  });
}

function createMainArtMask(width: number, height: number, bounds: CardBounds): HTMLCanvasElement {
  return createMaskCanvas(width, height, bounds, (ctx, maskBounds) => {
    fillNormalizedRect(ctx, maskBounds, TEMPLATE_MASKS.mainArtWindow);
  });
}

function createBonusBadgeMask(width: number, height: number, bounds: CardBounds): HTMLCanvasElement {
  return createMaskCanvas(width, height, bounds, (ctx, maskBounds) => {
    fillNormalizedEllipse(ctx, maskBounds, TEMPLATE_MASKS.modifierCircle);
  });
}

function createYellowUiRestoreMask(width: number, height: number, bounds: CardBounds): HTMLCanvasElement {
  return createMaskCanvas(width, height, bounds, (ctx, maskBounds) => {
    for (const rect of YELLOW_UI_RESTORE_RECTS) {
      fillNormalizedRect(ctx, maskBounds, rect);
    }
  });
}

function createProtectedRestoreMask(width: number, height: number, bounds: CardBounds): HTMLCanvasElement {
  return createMaskCanvas(width, height, bounds, (ctx, maskBounds) => {
    for (const rect of PROTECTED_RESTORE_RECTS) {
      fillNormalizedRect(ctx, maskBounds, rect);
    }
  });
}

function applyMask(layer: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const context = mustGetContext(layer);
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.drawImage(mask, 0, 0);
  context.restore();
  return layer;
}

function copyLayer(source: HTMLCanvasElement): HTMLCanvasElement {
  const layer = createCanvas(source.width, source.height);
  mustGetContext(layer).drawImage(source, 0, 0);
  return layer;
}

function createOriginalRestoreLayer(source: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  return applyMask(copyLayer(source), mask);
}

function getLuma(original: Uint8ClampedArray, width: number, height: number): Float32Array {
  const luma = new Float32Array(width * height);

  for (let i = 0; i < original.length; i += 4) {
    luma[i / 4] = luminance(original[i] ?? 0, original[i + 1] ?? 0, original[i + 2] ?? 0);
  }

  return luma;
}

function createZeroArtworkLayer(source: HTMLCanvasElement, bounds: CardBounds, options: Required<ZeroCardFilterOptions>): HTMLCanvasElement {
  const layer = copyLayer(source);
  const context = mustGetContext(layer);
  const imageData = context.getImageData(0, 0, layer.width, layer.height);
  const { width, height, data } = imageData;
  const original = new Uint8ClampedArray(data);
  const luma = getLuma(original, width, height);
  const boundsW = Math.max(1, bounds.right - bounds.left);
  const boundsH = Math.max(1, bounds.bottom - bounds.top);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;

      if ((original[idx + 3] ?? 255) === 0) continue;

      const nx = Math.max(0, Math.min(1, (x - bounds.left) / boundsW));
      const ny = Math.max(0, Math.min(1, (y - bounds.top) / boundsH));
      const baseLuma = luma[y * width + x] ?? 0;
      let tone = (baseLuma - 128) * options.contrast + 128;
      tone -= Math.min(48, sobelAt(luma, width, height, x, y) * options.edgeStrength);
      tone -= Math.max(0, Math.min(1, Math.sqrt(((nx - 0.5) / 0.52) ** 2 + ((ny - 0.38) / 0.52) ** 2))) * 10;
      tone += hashNoise(x, y) * options.noise;

      if (options.posterize) tone = posterizeTone(tone);

      const finalTone = clamp255(tone);
      data[idx] = finalTone;
      data[idx + 1] = finalTone;
      data[idx + 2] = finalTone;
    }
  }

  context.putImageData(imageData, 0, 0);
  return applyMask(layer, createMainArtMask(width, height, bounds));
}

function createCharcoalLayer(source: HTMLCanvasElement, mask: HTMLCanvasElement, opacity: number): HTMLCanvasElement {
  const layer = copyLayer(source);
  const context = mustGetContext(layer);
  const imageData = context.getImageData(0, 0, layer.width, layer.height);
  const { width, height, data } = imageData;
  const original = new Uint8ClampedArray(data);
  const luma = getLuma(original, width, height);

  for (let i = 0; i < data.length; i += 4) {
    if ((original[i + 3] ?? 255) === 0) continue;

    const pixel = i / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const baseLuma = luma[pixel] ?? 0;
    const tone = clamp255(Math.min(58, baseLuma * 0.32 + 8 + hashNoise(x, y) * 5));

    data[i] = tone;
    data[i + 1] = tone;
    data[i + 2] = tone;
    data[i + 3] = clamp255((data[i + 3] ?? 255) * opacity);
  }

  context.putImageData(imageData, 0, 0);
  return applyMask(layer, mask);
}

function drawZeroLogoOverlay(ctx: CanvasRenderingContext2D, bounds: CardBounds): void {
  const boundsW = Math.max(1, bounds.right - bounds.left);
  const boundsH = Math.max(1, bounds.bottom - bounds.top);
  const x = bounds.left + boundsW * 0.15;
  const y = bounds.top + boundsH * 0.165;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-7 * Math.PI) / 180);
  ctx.font = `700 italic ${Math.floor(boundsH * 0.039)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(18, 18, 18, 0.88)";
  ctx.lineWidth = Math.max(1, Math.floor(boundsW * 0.002));
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
  const source = createCanvas(imageData.width, imageData.height);
  const context = mustGetContext(source);
  context.putImageData(imageData, 0, 0);

  const result = composeZeroCardCanvas(source, optionsInput);
  const resultContext = mustGetContext(result);
  return resultContext.getImageData(0, 0, result.width, result.height);
}

function composeZeroCardCanvas(source: HTMLCanvasElement, optionsInput: ZeroCardFilterOptions = {}): HTMLCanvasElement {
  const options = { ...DEFAULT_OPTIONS, ...optionsInput };
  const result = copyLayer(source);
  const resultContext = mustGetContext(result);
  const sourceContext = mustGetContext(source);
  const sourceData = sourceContext.getImageData(0, 0, source.width, source.height);
  const bounds = detectCardBounds(new Uint8ClampedArray(sourceData.data), source.width, source.height);
  const mainArtLayer = createZeroArtworkLayer(source, bounds, options);
  const outerFrameMask = createOuterFrameMask(source.width, source.height, bounds);
  const bonusBadgeMask = createBonusBadgeMask(source.width, source.height, bounds);
  const yellowUiRestoreMask = createYellowUiRestoreMask(source.width, source.height, bounds);
  const protectedRestoreMask = createProtectedRestoreMask(source.width, source.height, bounds);
  const outerFrameLayer = createCharcoalLayer(source, outerFrameMask, 1);
  const bonusBadgeLayer = createCharcoalLayer(source, bonusBadgeMask, 0.92);
  const yellowRestoreLayer = createOriginalRestoreLayer(source, yellowUiRestoreMask);
  const protectedRestoreLayer = createOriginalRestoreLayer(source, protectedRestoreMask);

  resultContext.drawImage(mainArtLayer, 0, 0);
  resultContext.drawImage(outerFrameLayer, 0, 0);
  resultContext.drawImage(bonusBadgeLayer, 0, 0);
  resultContext.drawImage(yellowRestoreLayer, 0, 0);
  resultContext.drawImage(protectedRestoreLayer, 0, 0);
  applyPrintTexture(resultContext, result.width, result.height, options.textureOpacity);
  drawZeroLogoOverlay(resultContext, bounds);

  return result;
}

export async function createZeroCardVariantCanvas(src: string, options?: ZeroCardFilterOptions): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const source = createCanvas(image.naturalWidth, image.naturalHeight);
  const sourceContext = mustGetContext(source);
  sourceContext.drawImage(image, 0, 0);

  return composeZeroCardCanvas(source, options);
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
