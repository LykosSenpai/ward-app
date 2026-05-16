export type ZeroCardFilterOptions = {
  contrast?: number;
  edgeStrength?: number;
  noise?: number;
  posterize?: boolean;
};

const DEFAULT_OPTIONS: Required<ZeroCardFilterOptions> = {
  contrast: 1.35,
  edgeStrength: 0.7,
  noise: 10,
  posterize: true,
};

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

function isOuterFrame(nx: number, ny: number): boolean {
  return nx < 0.047 || nx > 0.953 || ny < 0.025 || ny > 0.977;
}

function isYellowGoldHue(h: number, s: number, l: number): boolean {
  return h >= 32 && h <= 58 && s > 0.18 && l > 0.18;
}

function isRedAccentHue(h: number, s: number, l: number): boolean {
  return (h < 18 || h > 345) && s > 0.35 && l > 0.18;
}

function hashNoise(x: number, y: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;

  return ((n & 0xffff) / 0xffff) - 0.5;
}

function posterizeTone(value: number): number {
  const palette = [18, 42, 72, 108, 150, 196, 232];

  let best = palette[0];
  let bestDistance = Math.abs(value - best);

  for (const tone of palette) {
    const distance = Math.abs(value - tone);

    if (distance < bestDistance) {
      best = tone;
      bestDistance = distance;
    }
  }

  return best;
}

function sobelAt(
  luma: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) {
    return 0;
  }

  const sample = (sx: number, sy: number): number => luma[sy * width + sx] ?? 0;

  const tl = sample(x - 1, y - 1);
  const t = sample(x, y - 1);
  const tr = sample(x + 1, y - 1);

  const l = sample(x - 1, y);
  const r = sample(x + 1, y);

  const bl = sample(x - 1, y + 1);
  const b = sample(x, y + 1);
  const br = sample(x + 1, y + 1);

  const gx = -tl + tr - 2 * l + 2 * r - bl + br;
  const gy = -tl - 2 * t - tr + bl + 2 * b + br;

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

export function applyZeroCardFilter(
  imageData: ImageData,
  optionsInput: ZeroCardFilterOptions = {},
): ImageData {
  const options = {
    ...DEFAULT_OPTIONS,
    ...optionsInput,
  };

  const { width, height, data } = imageData;
  const original = new Uint8ClampedArray(data);
  const luma = new Float32Array(width * height);

  for (let index = 0; index < original.length; index += 4) {
    const pixelIndex = index / 4;

    luma[pixelIndex] = luminance(
      original[index] ?? 0,
      original[index + 1] ?? 0,
      original[index + 2] ?? 0,
    );
  }

  for (let y = 0; y < height; y += 1) {
    const ny = height <= 1 ? 0 : y / (height - 1);

    for (let x = 0; x < width; x += 1) {
      const nx = width <= 1 ? 0 : x / (width - 1);
      const index = (y * width + x) * 4;

      const r = original[index] ?? 0;
      const g = original[index + 1] ?? 0;
      const b = original[index + 2] ?? 0;
      const a = original[index + 3] ?? 255;

      if (a === 0) {
        continue;
      }

      const { h, s, l } = rgbToHsl(r, g, b);
      const baseLuma = luma[y * width + x] ?? 0;

      const inArt = isArtRegion(nx, ny);
      const inGoldUi = isGoldUiRegion(nx, ny);
      const inOuterFrame = isOuterFrame(nx, ny);

      const isRedAccent = isRedAccentHue(h, s, l);
      const isYellowGold = isYellowGoldHue(h, s, l);

      // Red frame / regular-card red accents become black in the Zero variant.
      // Do not do this inside the art area; red/orange art backgrounds should become grayscale, not solid black.
      if (!inArt && (isRedAccent || (inOuterFrame && s > 0.25 && baseLuma > 40))) {
        const frameTone = baseLuma > 75 ? 20 : baseLuma * 0.25;

        data[index] = clamp255(frameTone);
        data[index + 1] = clamp255(frameTone);
        data[index + 2] = clamp255(frameTone);
        data[index + 3] = a;
        continue;
      }

      // Keep the yellow/gold card UI panels recognizable.
      if (inGoldUi && isYellowGold) {
        data[index] = clamp255(r * 1.02 + 4);
        data[index + 1] = clamp255(g * 0.96 + 5);
        data[index + 2] = clamp255(b * 0.72);
        data[index + 3] = a;
        continue;
      }

      let tone = (baseLuma - 128) * (inArt ? options.contrast : 1.12) + 128;

      if (inArt) {
        const edge = Math.min(68, sobelAt(luma, width, height, x, y) * options.edgeStrength);
        tone -= edge;

        const dx = (nx - 0.5) / 0.52;
        const dy = (ny - 0.38) / 0.54;
        const vignette = Math.max(0, Math.min(1, Math.sqrt(dx * dx + dy * dy)));

        tone -= vignette * 18;
        tone += hashNoise(x, y) * options.noise;

        if (options.posterize) {
          tone = posterizeTone(tone);
        }
      } else if (inGoldUi) {
        // Darken black text, slash graphics, and brown ink marks inside the UI panels.
        if (tone < 155) {
          tone *= 0.55;
        }
      } else if (s > 0.2) {
        // Any remaining saturated color outside the UI becomes monochrome.
        tone = (tone - 128) * 1.1 + 128;
      }

      const finalTone = clamp255(tone);

      data[index] = finalTone;
      data[index + 1] = finalTone;
      data[index + 2] = finalTone;
      data[index + 3] = a;
    }
  }

  return imageData;
}

export async function createZeroCardVariantCanvas(
  src: string,
  options?: ZeroCardFilterOptions,
): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const filteredImageData = applyZeroCardFilter(imageData, options);

  context.putImageData(filteredImageData, 0, 0);

  return canvas;
}

export async function createZeroCardVariantDataUrl(
  src: string,
  options?: ZeroCardFilterOptions,
): Promise<string> {
  const canvas = await createZeroCardVariantCanvas(src, options);

  return canvas.toDataURL("image/png");
}

export async function createZeroCardVariantBlob(
  src: string,
  options?: ZeroCardFilterOptions,
): Promise<Blob> {
  const canvas = await createZeroCardVariantCanvas(src, options);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to export generated Zero card image."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}
