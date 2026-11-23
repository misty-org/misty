export interface Part {
  text: string;
  marked: boolean;
}

export function fold(text: string): string {
  let out = "";
  for (const char of text.toLocaleLowerCase()) {
    const plain = char.normalize("NFD").replace(/\p{M}+/gu, "");
    out += plain.length === char.length ? plain : char;
  }
  return out;
}

function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

const tokenPattern = /[\p{L}\p{N}]+/gu;

function tokens(text: string): { word: string; at: number }[] {
  return [...text.matchAll(tokenPattern)].map((match) => ({ word: match[0], at: match.index }));
}

export function within(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let before = Array.from({ length: b.length + 1 }, (_, j) => j);
  let previous: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(before[j] + 1, row[j - 1] + 1, before[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, previous[j - 2] + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return false;
    previous = before;
    before = row;
  }
  return before[b.length] <= limit;
}

const slips = (word: string) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

function looseMeets(word: string, token: string): boolean {
  const limit = slips(word);
  if (!limit) return false;
  return within(word, token, limit) || within(word, token.slice(0, word.length), limit);
}

function wordScore(text: string, words: { word: string; at: number }[], word: string): number {
  if (text.startsWith(word)) return 10;
  if (words.some((token) => token.word === word)) return 8;
  if (words.some((token) => token.word.startsWith(word))) return 6;
  if (text.includes(word)) return 4;
  if (words.some((token) => looseMeets(word, token.word))) return 2;
  return 0;
}

export function matchScore(text: string, query: string): number {
  const words = queryWords(query);
  if (!words.length) return 1;
  const folded = fold(text);
  const found = tokens(folded);
  let total = 0;
  for (const word of words) {
    const score = wordScore(folded, found, word);
    if (!score) return 0;
    total += score;
  }
  const phrase = words.length > 1 && folded.includes(words.join(" ")) ? 4 : 0;
  return total / words.length + phrase;
}

export function fieldScore(query: string, title: string, ...rest: (string | undefined)[]) {
  const head = matchScore(title, query);
  const body = rest.filter(Boolean).join(" ");
  const all = body ? matchScore(`${title} ${body}`, query) * 0.6 : 0;
  return Math.max(head, all);
}

function ranges(text: string, query: string): [number, number][] {
  const words = queryWords(query);
  const folded = fold(text);
  const found: [number, number][] = [];
  for (const word of words) {
    let from = folded.indexOf(word);
    let hit = from >= 0;
    while (from >= 0) {
      found.push([from, from + word.length]);
      from = folded.indexOf(word, from + word.length);
    }
    if (hit) continue;
    for (const token of tokens(folded))
      if (looseMeets(word, token.word)) {
        found.push([token.at, token.at + token.word.length]);
        hit = true;
      }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export function markParts(text: string, query: string): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const [start, end] of ranges(text, query)) {
    if (start > at) parts.push({ text: text.slice(at, start), marked: false });
    parts.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), marked: false });
  return parts;
}

export function excerpt(text: string, query: string, size = 120): Part[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const first = ranges(flat, query)[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(size / 3));
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space >= 0 && space < first) start = space + 1;
  }
  const end = Math.min(flat.length, start + size);
  const cut = `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
  return markParts(cut, query);
}

export function rank(input: {
  match: number;
  weight?: number;
  updatedAt?: string;
  uses?: number;
  now?: number;
}): number {
  const now = input.now ?? Date.now();
  const at = input.updatedAt ? Date.parse(input.updatedAt) : NaN;
  const days = Number.isNaN(at) ? Infinity : Math.max(0, (now - at) / 86_400_000);
  const recent = days === Infinity ? 0 : 3 / (1 + days / 7);
  const used = Math.log2(1 + (input.uses ?? 0)) * 2;
  return input.match * (input.weight ?? 1) + recent + used;
}
