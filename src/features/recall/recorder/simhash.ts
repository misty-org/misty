const MASK = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a(text: string) {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash;
}

/**
 * A 64-bit simhash of the page's words (three-word shingles), as 16 hex
 * digits. Pages that barely changed land a few bits apart, so a revisit
 * can point at what was already remembered instead of storing it again.
 */
export function simhash(text: string) {
  const words = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const weights = new Array<number>(64).fill(0);
  const count = Math.max(1, words.length - 2);
  for (let i = 0; i < count; i++) {
    const hash = fnv1a(words.slice(i, i + 3).join(" "));
    for (let bit = 0; bit < 64; bit++) weights[bit] += (hash >> BigInt(bit)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) if (weights[bit] > 0) out |= 1n << BigInt(bit);
  return out.toString(16).padStart(16, "0");
}

/** How many bits two simhashes differ by. */
export function hammingDistance(left: string, right: string) {
  let diff = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let bits = 0;
  while (diff) {
    bits += Number(diff & 1n);
    diff >>= 1n;
  }
  return bits;
}
