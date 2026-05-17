const input = process.argv[2];
if (!input?.startsWith("WARDDECK3:")) throw new Error("pass WARDDECK3 string");

function decodeB64Url(value) {
  const n = value.replace(/-/g, "+").replace(/_/g, "/");
  const p = n.padEnd(Math.ceil(n.length / 4) * 4, "=");
  return Buffer.from(p, "base64");
}

function encodeB64UrlBytes(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigintToBase(value, alphabet) {
  if (value === 0n) return alphabet[0];
  const base = BigInt(alphabet.length);
  let x = value;
  let result = "";
  while (x > 0n) {
    const idx = Number(x % base);
    result = alphabet[idx] + result;
    x /= base;
  }
  return result;
}

function encodeScaledDecimal(value) {
  const text = value.toString(10);
  const trimmed = text.replace(/0+$/g, "");
  const zeroCount = text.length - trimmed.length;
  const coefficient = trimmed.length > 0 ? trimmed : "0";
  return { coefficient, zeroCount, encoded: `${coefficient}*10^${zeroCount}` };
}

function encodeBase151(num) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_~.$*";
  if (num < 1 || num > 151) throw new Error(`card number out of range 1..151: ${num}`);
  return alphabet[num - 1];
}

function buildSymbolicV4(cards) {
  const genBrackets = {
    1: ["!", "!"],
    2: ["@", "@"],
    3: ["#", "#"],
    4: ["$", "$"],
    5: ["%", "%"],
    6: ["^", "^"],
    7: ["&", "&"],
    8: ["(", ")"]
  };
  const artBracket = {
    z: ["[", "]"],
    h: ["{", "}"],
    zh: ["<", ">"]
  };

  const byGen = new Map();
  for (const card of cards) {
    const list = byGen.get(card.gen) ?? [];
    list.push(card);
    byGen.set(card.gen, list);
  }

  const genKeys = [...byGen.keys()].sort((a, b) => a - b);
  const segments = genKeys.map(gen => {
    const [openGen, closeGen] = genBrackets[gen] ?? [`g${gen}(`, ")"];
    const entries = byGen.get(gen);

    const defaultSeq = [];
    const zeroSeq = [];
    const holoSeq = [];
    const zeroHoloSeq = [];

    for (const entry of entries) {
      const token = encodeBase151(entry.num);
      if (entry.art === "z") zeroSeq.push(token);
      else if (entry.art === "h") holoSeq.push(token);
      else if (entry.art === "zh") zeroHoloSeq.push(token);
      else defaultSeq.push(token);
    }

    const chunks = [];
    if (defaultSeq.length) chunks.push(defaultSeq.join(""));
    if (zeroSeq.length) {
      const [o, c] = artBracket.z;
      chunks.push(`${o}${zeroSeq.join("")}${c}`);
    }
    if (holoSeq.length) {
      const [o, c] = artBracket.h;
      chunks.push(`${o}${holoSeq.join("")}${c}`);
    }
    if (zeroHoloSeq.length) {
      const [o, c] = artBracket.zh;
      chunks.push(`${o}${zeroHoloSeq.join("")}${c}`);
    }

    return `${openGen}${chunks.join("")}${closeGen}`;
  });

  return `WARDDECK4SYM:${segments.join("")}`;
}

const body = JSON.parse(decodeB64Url(input.slice("WARDDECK3:".length)).toString("utf8"));
if (body.v !== 3 || body.k !== "WD") throw new Error("not v3");

const expanded = [];
for (const e of body.c) {
  if (Array.isArray(e)) {
    const [ref, count = 1, art = ""] = e;
    for (let i = 0; i < count; i += 1) expanded.push({ ref, art: String(art || "") });
  } else {
    expanded.push({ ref: e, art: "" });
  }
}
if (expanded.length > 30) throw new Error(`deck size ${expanded.length} > 30`);

const cards = expanded.map(({ ref, art }) => {
  const [g36, n36] = String(ref).split(".");
  const gen = parseInt(g36, 36);
  const num = parseInt(n36, 36);
  if (!Number.isInteger(gen) || gen < 0 || gen > 15) throw new Error(`generation out of packable range 0..15: ${gen}`);
  if (!Number.isInteger(num) || num < 1 || num > 151) throw new Error(`card number out of range 1..151: ${num}`);
  return { gen, num, art: String(art || "") };
});

// previous packed format baseline
const artToBits = { "": 0, h: 1, z: 2, zh: 3 };
const sortedCards = [...cards].sort((a, b) => a.gen - b.gen || a.num - b.num || (artToBits[a.art] ?? 0) - (artToBits[b.art] ?? 0));
const bits = [];
const pushBits = (value, width) => {
  for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
};
pushBits(4, 4);
pushBits(sortedCards.length, 6);
for (const c of sortedCards) {
  pushBits(c.gen, 4);
  pushBits(c.num - 1, 8);
  pushBits(artToBits[c.art] ?? 0, 2);
}
while (bits.length % 8 !== 0) bits.push(0);
const packed = new Uint8Array(bits.length / 8);
for (let i = 0; i < bits.length; i += 8) {
  let byte = 0;
  for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
  packed[i / 8] = byte;
}
const v4 = `WARDDECK4:${encodeB64UrlBytes(packed)}`;
const packedBigInt = bytesToBigInt(packed);
const v4Numeric = packedBigInt.toString(10);
const scaledDecimal = encodeScaledDecimal(packedBigInt);
const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const v4Base62Deck = `WARDDECK4B62:${bigintToBase(packedBigInt, base62Alphabet)}`;
const v4Sym = buildSymbolicV4(cards);

console.log(JSON.stringify({
  deckName: body.n,
  totalCards: expanded.length,
  v3Length: input.length,
  v4Length: v4.length,
  v4SymbolicLength: v4Sym.length,
  v4NumericLength: v4Numeric.length,
  v4Base62Length: v4Base62Deck.length,
  v4ScaledDecimalLength: scaledDecimal.encoded.length,
  savingsVsV3: input.length - v4.length,
  symbolicSavingsVsV3: input.length - v4Sym.length,
  savingsPctVsV3: Number((((input.length - v4.length) / input.length) * 100).toFixed(2)),
  symbolicSavingsPctVsV3: Number((((input.length - v4Sym.length) / input.length) * 100).toFixed(2)),
  note: "Added WARDDECK4SYM generation-capture format with nested art capture groups (default + [zero] + {holo} + <zero-holo>) per generation.",
  v4PackedBitLength: bits.length,
  v4,
  v4Sym,
  v4Numeric,
  v4ScaledDecimal: scaledDecimal.encoded,
  v4Base62Deck
}, null, 2));
