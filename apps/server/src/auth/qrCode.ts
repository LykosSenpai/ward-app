const QR_VERSION = 10;
const QR_SIZE = QR_VERSION * 4 + 17;
const QR_EC_LEVEL_LOW_FORMAT_BITS = 1;
const QR_ECC_CODEWORDS_PER_BLOCK = 18;
const QR_DATA_BLOCK_LENGTHS = [68, 68, 69, 69];
const QR_DATA_CODEWORDS = QR_DATA_BLOCK_LENGTHS.reduce((sum, length) => sum + length, 0);
const QR_ALIGNMENT_PATTERN_CENTERS = [6, 28, 50];
const QR_FORMAT_INFO_GENERATOR = 0x537;
const QR_FORMAT_INFO_MASK = 0x5412;
const QR_VERSION_INFO_GENERATOR = 0x1f25;
const QR_QUIET_ZONE_SIZE = 4;
const QR_PAD_CODEWORDS = [0xec, 0x11];

type QrMatrix = boolean[][];

export function createQrCodeDataUrl(value: string): string {
  const dataCodewords = encodeQrByteData(value);
  const codewords = addErrorCorrection(dataCodewords);
  const modules = createQrMatrix(codewords);
  return createSvgDataUrl(modules);
}

function encodeQrByteData(value: string): number[] {
  const bytes = Buffer.from(value, "utf8");
  const capacityBits = QR_DATA_CODEWORDS * 8;
  const maxByteLength = Math.floor((capacityBits - 4 - 16) / 8);

  if (bytes.length > maxByteLength) {
    throw new Error("Authenticator setup URI is too long to encode as a QR code.");
  }

  const bits = new BitBuffer();
  bits.append(0b0100, 4);
  bits.append(bytes.length, 16);

  for (const byte of bytes) {
    bits.append(byte, 8);
  }

  bits.append(0, Math.min(4, capacityBits - bits.length));

  while (bits.length % 8 !== 0) {
    bits.append(0, 1);
  }

  const codewords = bits.toCodewords();
  let padIndex = 0;

  while (codewords.length < QR_DATA_CODEWORDS) {
    codewords.push(QR_PAD_CODEWORDS[padIndex % QR_PAD_CODEWORDS.length]);
    padIndex += 1;
  }

  return codewords;
}

function addErrorCorrection(dataCodewords: number[]): number[] {
  const blocks = QR_DATA_BLOCK_LENGTHS.map((length, index) => {
    const start = QR_DATA_BLOCK_LENGTHS.slice(0, index).reduce((sum, blockLength) => sum + blockLength, 0);
    const data = dataCodewords.slice(start, start + length);
    return {
      data,
      ecc: createReedSolomonRemainder(data, QR_ECC_CODEWORDS_PER_BLOCK)
    };
  });
  const result: number[] = [];
  const maxDataLength = Math.max(...blocks.map(block => block.data.length));

  for (let index = 0; index < maxDataLength; index += 1) {
    for (const block of blocks) {
      const codeword = block.data[index];
      if (codeword !== undefined) result.push(codeword);
    }
  }

  for (let index = 0; index < QR_ECC_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of blocks) {
      result.push(block.ecc[index]);
    }
  }

  return result;
}

function createQrMatrix(codewords: number[]): QrMatrix {
  const modules = createEmptyMatrix();
  const isFunction = createEmptyMatrix();

  drawFunctionPatterns(modules, isFunction);
  drawCodewords(modules, isFunction, codewords);

  let bestModules = modules;
  let lowestPenalty = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = cloneMatrix(modules);
    applyMask(candidate, isFunction, mask);
    drawFormatBits(candidate, isFunction, mask);
    const penalty = calculatePenalty(candidate);

    if (penalty < lowestPenalty) {
      bestModules = candidate;
      lowestPenalty = penalty;
    }
  }

  return bestModules;
}

function drawFunctionPatterns(modules: QrMatrix, isFunction: QrMatrix): void {
  drawFinderPattern(modules, isFunction, 0, 0);
  drawFinderPattern(modules, isFunction, QR_SIZE - 7, 0);
  drawFinderPattern(modules, isFunction, 0, QR_SIZE - 7);

  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    const dark = i % 2 === 0;
    setFunctionModule(modules, isFunction, i, 6, dark);
    setFunctionModule(modules, isFunction, 6, i, dark);
  }

  for (const x of QR_ALIGNMENT_PATTERN_CENTERS) {
    for (const y of QR_ALIGNMENT_PATTERN_CENTERS) {
      const overlapsFinder = (x === 6 && y === 6) ||
        (x === 6 && y === QR_SIZE - 7) ||
        (x === QR_SIZE - 7 && y === 6);
      if (!overlapsFinder) drawAlignmentPattern(modules, isFunction, x, y);
    }
  }

  drawVersionInfo(modules, isFunction);
  drawFormatBits(modules, isFunction, 0);
}

function drawFinderPattern(modules: QrMatrix, isFunction: QrMatrix, left: number, top: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = left + dx;
      const y = top + dy;
      if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) continue;

      const isFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
        (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunctionModule(modules, isFunction, x, y, isFinder);
    }
  }
}

function drawAlignmentPattern(modules: QrMatrix, isFunction: QrMatrix, centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const dark = Math.max(Math.abs(dx), Math.abs(dy)) === 2 || (dx === 0 && dy === 0);
      setFunctionModule(modules, isFunction, centerX + dx, centerY + dy, dark);
    }
  }
}

function drawVersionInfo(modules: QrMatrix, isFunction: QrMatrix): void {
  const bits = getVersionInfoBits(QR_VERSION);

  for (let i = 0; i < 18; i += 1) {
    const dark = getBit(bits, i);
    const x = QR_SIZE - 11 + (i % 3);
    const y = Math.floor(i / 3);
    setFunctionModule(modules, isFunction, x, y, dark);
    setFunctionModule(modules, isFunction, y, x, dark);
  }
}

function drawFormatBits(modules: QrMatrix, isFunction: QrMatrix, mask: number): void {
  const bits = getFormatInfoBits(mask);

  for (let i = 0; i <= 5; i += 1) {
    setFunctionModule(modules, isFunction, 8, i, getBit(bits, i));
  }

  setFunctionModule(modules, isFunction, 8, 7, getBit(bits, 6));
  setFunctionModule(modules, isFunction, 8, 8, getBit(bits, 7));
  setFunctionModule(modules, isFunction, 7, 8, getBit(bits, 8));

  for (let i = 9; i < 15; i += 1) {
    setFunctionModule(modules, isFunction, 14 - i, 8, getBit(bits, i));
  }

  for (let i = 0; i < 8; i += 1) {
    setFunctionModule(modules, isFunction, QR_SIZE - 1 - i, 8, getBit(bits, i));
  }

  for (let i = 8; i < 15; i += 1) {
    setFunctionModule(modules, isFunction, 8, QR_SIZE - 15 + i, getBit(bits, i));
  }

  setFunctionModule(modules, isFunction, 8, QR_SIZE - 8, true);
}

function drawCodewords(modules: QrMatrix, isFunction: QrMatrix, codewords: number[]): void {
  let bitIndex = 0;
  let upward = true;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;

    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;

      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (isFunction[y][x]) continue;

        const codeword = codewords[bitIndex >>> 3] ?? 0;
        modules[y][x] = getBit(codeword, 7 - (bitIndex & 7));
        bitIndex += 1;
      }
    }

    upward = !upward;
  }
}

function applyMask(modules: QrMatrix, isFunction: QrMatrix, mask: number): void {
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (!isFunction[y][x] && getMaskBit(mask, x, y)) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

function getMaskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return (x * y) % 2 + (x * y) % 3 === 0;
    case 6:
      return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7:
      return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default:
      return false;
  }
}

function calculatePenalty(modules: QrMatrix): number {
  let penalty = 0;
  let darkCount = 0;

  for (let y = 0; y < QR_SIZE; y += 1) {
    let runColor = modules[y][0];
    let runLength = 1;

    for (let x = 0; x < QR_SIZE; x += 1) {
      if (modules[y][x]) darkCount += 1;
      if (x === 0) continue;

      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        penalty += getRunPenalty(runLength);
        runColor = modules[y][x];
        runLength = 1;
      }
    }

    penalty += getRunPenalty(runLength);
  }

  for (let x = 0; x < QR_SIZE; x += 1) {
    let runColor = modules[0][x];
    let runLength = 1;

    for (let y = 1; y < QR_SIZE; y += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        penalty += getRunPenalty(runLength);
        runColor = modules[y][x];
        runLength = 1;
      }
    }

    penalty += getRunPenalty(runLength);
  }

  for (let y = 0; y < QR_SIZE - 1; y += 1) {
    for (let x = 0; x < QR_SIZE - 1; x += 1) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
        penalty += 3;
      }
    }
  }

  penalty += calculateFinderLikePenalty(modules);
  penalty += Math.floor(Math.abs(darkCount * 20 - QR_SIZE * QR_SIZE * 10) / (QR_SIZE * QR_SIZE)) * 10;
  return penalty;
}

function calculateFinderLikePenalty(modules: QrMatrix): number {
  let penalty = 0;

  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x <= QR_SIZE - 11; x += 1) {
      if (matchesFinderLikePattern((offset) => modules[y][x + offset])) penalty += 40;
    }
  }

  for (let x = 0; x < QR_SIZE; x += 1) {
    for (let y = 0; y <= QR_SIZE - 11; y += 1) {
      if (matchesFinderLikePattern((offset) => modules[y + offset][x])) penalty += 40;
    }
  }

  return penalty;
}

function matchesFinderLikePattern(read: (offset: number) => boolean): boolean {
  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const reversePattern = [false, false, false, false, true, false, true, true, true, false, true];
  return pattern.every((value, index) => read(index) === value) ||
    reversePattern.every((value, index) => read(index) === value);
}

function getRunPenalty(runLength: number): number {
  return runLength >= 5 ? runLength - 2 : 0;
}

function createReedSolomonRemainder(data: number[], degree: number): number[] {
  const generator = createReedSolomonGenerator(degree);
  const result = Array<number>(degree).fill(0);

  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);

    for (let i = 0; i < degree; i += 1) {
      result[i] ^= multiplyInGaloisField(generator[i + 1], factor);
    }
  }

  return result;
}

function createReedSolomonGenerator(degree: number): number[] {
  let result = [1];

  for (let i = 0; i < degree; i += 1) {
    const next = Array<number>(result.length + 1).fill(0);
    const root = getGaloisFieldExponent(i);

    for (let j = 0; j < result.length; j += 1) {
      next[j] ^= result[j];
      next[j + 1] ^= multiplyInGaloisField(result[j], root);
    }

    result = next;
  }

  return result;
}

function multiplyInGaloisField(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return getGaloisFieldExponent(getGaloisFieldLog(left) + getGaloisFieldLog(right));
}

const GALOIS_FIELD_TABLES = createGaloisFieldTables();

function createGaloisFieldTables(): { exponents: number[]; logarithms: number[] } {
  const exponents = Array<number>(512).fill(0);
  const logarithms = Array<number>(256).fill(0);
  let value = 1;

  for (let i = 0; i < 255; i += 1) {
    exponents[i] = value;
    logarithms[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }

  for (let i = 255; i < exponents.length; i += 1) {
    exponents[i] = exponents[i - 255];
  }

  return { exponents, logarithms };
}

function getGaloisFieldExponent(index: number): number {
  return GALOIS_FIELD_TABLES.exponents[index % 255];
}

function getGaloisFieldLog(value: number): number {
  return GALOIS_FIELD_TABLES.logarithms[value];
}

function getFormatInfoBits(mask: number): number {
  const data = (QR_EC_LEVEL_LOW_FORMAT_BITS << 3) | mask;
  return ((data << 10) | calculateBchRemainder(data << 10, QR_FORMAT_INFO_GENERATOR)) ^ QR_FORMAT_INFO_MASK;
}

function getVersionInfoBits(version: number): number {
  return (version << 12) | calculateBchRemainder(version << 12, QR_VERSION_INFO_GENERATOR);
}

function calculateBchRemainder(value: number, generator: number): number {
  let remainder = value;
  const generatorBits = getBchBitLength(generator);

  while (getBchBitLength(remainder) >= generatorBits) {
    remainder ^= generator << (getBchBitLength(remainder) - generatorBits);
  }

  return remainder;
}

function getBchBitLength(value: number): number {
  let length = 0;

  while (value !== 0) {
    length += 1;
    value >>>= 1;
  }

  return length;
}

function setFunctionModule(modules: QrMatrix, isFunction: QrMatrix, x: number, y: number, dark: boolean): void {
  modules[y][x] = dark;
  isFunction[y][x] = true;
}

function createEmptyMatrix(): QrMatrix {
  return Array.from({ length: QR_SIZE }, () => Array<boolean>(QR_SIZE).fill(false));
}

function cloneMatrix(matrix: QrMatrix): QrMatrix {
  return matrix.map(row => [...row]);
}

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function createSvgDataUrl(modules: QrMatrix): string {
  const viewBoxSize = QR_SIZE + QR_QUIET_ZONE_SIZE * 2;
  const path = modules.flatMap((row, y) =>
    row.map((dark, x) => dark ? `M${x + QR_QUIET_ZONE_SIZE},${y + QR_QUIET_ZONE_SIZE}h1v1h-1z` : "")
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${viewBoxSize}v${viewBoxSize}H0z"/><path fill="#000" d="${path}"/></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

class BitBuffer {
  private readonly bits: number[] = [];

  get length(): number {
    return this.bits.length;
  }

  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }

  toCodewords(): number[] {
    const codewords: number[] = [];

    for (let index = 0; index < this.bits.length; index += 8) {
      let codeword = 0;

      for (let offset = 0; offset < 8; offset += 1) {
        codeword = (codeword << 1) | (this.bits[index + offset] ?? 0);
      }

      codewords.push(codeword);
    }

    return codewords;
  }
}
