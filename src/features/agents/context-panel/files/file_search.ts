// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { SEARCH_RESULT_LIMIT, type IndexEntry as MentionEntry } from "./file_index";

export function workspaceRelativePrefix(root: string, absolute: string): string | null {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = absolute.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return null;
  if (target === base) return "";
  if (!target.startsWith(base + "/")) return null;
  return target.slice(base.length + 1);
}

export function scopeEntries(
  entries: MentionEntry[],
  root: string,
  searchRoot: string,
): MentionEntry[] {
  const prefix = workspaceRelativePrefix(root, searchRoot);
  if (prefix === null) return [];
  if (prefix === "") return entries;
  return entries.filter((entry) => entry.rel === prefix || entry.rel.startsWith(prefix + "/"));
}

const TIER = {
  NameExact: 0,
  NamePrefix: 1,
  NameSubstring: 2,
  NameSubsequence: 3,
  PathSubsequence: 4,
} as const;
type MatchTier = (typeof TIER)[keyof typeof TIER];

interface RankedRow {
  entry: MentionEntry;
  tier: MatchTier;
  offset: number;
}

function subsequenceAt(haystack: string, needle: string): number | null {
  let qi = 0;
  let first = -1;
  for (let i = 0; i < haystack.length && qi < needle.length; i++) {
    if (haystack[i] !== needle[qi]) continue;
    if (qi === 0) first = i;
    qi++;
  }
  return qi === needle.length ? first : null;
}

function rankEntry(entry: MentionEntry, q: string): RankedRow | null {
  const name = entry.name.toLowerCase();
  if (name === q) return { entry, tier: TIER.NameExact, offset: 0 };
  if (name.startsWith(q)) return { entry, tier: TIER.NamePrefix, offset: 0 };
  const inName = name.indexOf(q);
  if (inName >= 0) return { entry, tier: TIER.NameSubstring, offset: inName };
  const inNameSub = subsequenceAt(name, q);
  if (inNameSub !== null) {
    return { entry, tier: TIER.NameSubsequence, offset: inNameSub };
  }
  const inPath = subsequenceAt(entry.key, q);
  if (inPath !== null) return { entry, tier: TIER.PathSubsequence, offset: inPath };
  return null;
}

export function searchEntries(
  entries: MentionEntry[],
  root: string,
  searchRoot: string,
  query: string,
): MentionEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: RankedRow[] = [];
  for (const entry of scopeEntries(entries, root, searchRoot)) {
    const row = rankEntry(entry, q);
    if (row) ranked.push(row);
  }
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.offset - b.offset ||
      a.entry.rel.length - b.entry.rel.length ||
      (a.entry.rel < b.entry.rel ? -1 : a.entry.rel > b.entry.rel ? 1 : 0),
  );
  return ranked.slice(0, SEARCH_RESULT_LIMIT).map((row) => row.entry);
}
