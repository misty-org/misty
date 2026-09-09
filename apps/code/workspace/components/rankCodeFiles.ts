import type { WalkedFile } from "../native";

export function rankFiles(files: WalkedFile[], query: string, limit = 500): WalkedFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle || needle.startsWith(":")) return files.slice(0, limit);
  return files
    .map((file) => {
      const pathScore = fuzzyScore(file.relative.toLowerCase(), needle);
      const nameScore = fuzzyScore(file.name.toLowerCase(), needle);
      return { file, score: Math.max(pathScore, nameScore < 0 ? -1 : nameScore + 2_000) };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.file.relative.length - b.file.relative.length)
    .slice(0, limit)
    .map((entry) => entry.file);
}

function fuzzyScore(value: string, needle: string): number {
  const direct = value.indexOf(needle);
  if (direct >= 0) return 10_000 - direct * 10 - value.length;
  let cursor = 0;
  let score = 0;
  let previous = -2;
  for (const character of needle) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return -1;
    score += index === previous + 1 ? 25 : 5;
    if (index === 0 || "/._-".includes(value[index - 1] ?? "")) score += 20;
    previous = index;
    cursor = index + 1;
  }
  return score - value.length * 0.01;
}
