/** Matches the API's sorted-key canonical JSON representation. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

// Small dependency-free SHA-256 implementation so checksums are identical in Hermes and Vitest.
const rightRotate = (value: number, amount: number) =>
  (value >>> amount) | (value << (32 - amount));
const constants = [
  1116352408, 1899447441, -1245643825, -373957723, 961987163, 1508970993, -1841331548, -1424204075,
  -670586216, 310598401, 607225278, 1426881987, 1925078388, -2132889090, -1680079193, -1046744716,
  -459576895, -272742522, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
  -1740746414, -1473132947, -1341970488, -1084653625, -958395405, -710438585, 113926993, 338241895,
  666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, -2117940946, -1838011259,
  -1564481375, -1474664885, -1035236496, -949202525, -778901479, -694614492, -200395387, 275423344,
  430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
  1955562222, 2024104815, -2067236844, -1933114872, -1866530822, -1538233109, -1090935817,
  -965641998
] as const;
export const sha256 = (input: string): string => {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  for (let i = 0; i < 8; i++)
    padded[padded.length - 1 - i] = Math.floor(bitLength / 2 ** (i * 8)) & 255;
  const hash = [
    1779033703, -1150833019, 1013904242, -1521486534, 1359893119, -1694144372, 528734635, 1541459225
  ];
  const words = new Int32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++)
      words[i] =
        (padded[offset + i * 4]! << 24) |
        (padded[offset + i * 4 + 1]! << 16) |
        (padded[offset + i * 4 + 2]! << 8) |
        padded[offset + i * 4 + 3]!;
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15]!,
        b = words[i - 2]!;
      words[i] =
        (rightRotate(a, 7) ^ rightRotate(a, 18) ^ (a >>> 3)) +
        words[i - 16]! +
        (rightRotate(b, 17) ^ rightRotate(b, 19) ^ (b >>> 10)) +
        words[i - 7]!;
    }
    let a = hash[0]!,
      b = hash[1]!,
      c = hash[2]!,
      d = hash[3]!,
      e = hash[4]!,
      f = hash[5]!,
      g = hash[6]!,
      h = hash[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + constants[i]! + words[i]!) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + s0 + majority) | 0;
    }
    hash[0] = (hash[0]! + a) | 0;
    hash[1] = (hash[1]! + b) | 0;
    hash[2] = (hash[2]! + c) | 0;
    hash[3] = (hash[3]! + d) | 0;
    hash[4] = (hash[4]! + e) | 0;
    hash[5] = (hash[5]! + f) | 0;
    hash[6] = (hash[6]! + g) | 0;
    hash[7] = (hash[7]! + h) | 0;
  }
  return hash.map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('');
};
