import type { EntryFilterMatcher } from "@/models/types/features/explorer/components/FileBrowserFilters";
export type { EntryFilterMatcher } from "@/models/types/features/explorer/components/FileBrowserFilters";
import type { FileEntry } from "@/models/interfaces/services/misty-api";

export function compileEntryFilterMatcher(query: string): EntryFilterMatcher | null {
  if (!query) return null;
  const regexExpression = regexExpressionForFilterQuery(query);
  if (regexExpression) return { kind: "pattern", expression: regexExpression };
  if (query.includes("*") || query.includes("?")) {
    return { kind: "pattern", expression: globExpressionForFilterQuery(query) };
  }
  return { kind: "substring", query: query.toLowerCase() };
}

export function entryMatchesQuery(entry: FileEntry, matcher: EntryFilterMatcher): boolean {
  const haystack = [
    entry.name,
    entry.extension,
    entry.mimeType ?? "",
    entry.kind,
    entry.location.remoteName ?? "",
    entry.location.providerType ?? "",
  ].join(" ");
  if (matcher.kind === "pattern") return matcher.expression.test(haystack);
  return haystack.toLowerCase().includes(matcher.query);
}

function regexExpressionForFilterQuery(query: string): RegExp | null {
  if (query.startsWith("regex:")) {
    return safeRegex(query.slice("regex:".length), "i");
  }
  if (!query.startsWith("/")) return null;
  const closingSlashIndex = lastUnescapedSlashIndex(query);
  if (closingSlashIndex <= 0) return null;
  const pattern = query.slice(1, closingSlashIndex);
  const flags = query.slice(closingSlashIndex + 1) || "i";
  return safeRegex(pattern, normalizeRegexFlags(flags));
}

function globExpressionForFilterQuery(query: string): RegExp {
  const escaped = query
    .split("")
    .map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return escapeRegexCharacter(character);
    })
    .join("");
  return new RegExp(escaped, "i");
}

function lastUnescapedSlashIndex(value: string): number {
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] !== "/") continue;
    let backslashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      backslashCount += 1;
    }
    if (backslashCount % 2 === 0) return index;
  }
  return -1;
}

function normalizeRegexFlags(flags: string): string {
  const allowed = new Set(["d", "i", "m", "s", "u", "v"]);
  const normalized = Array.from(flags).filter(
    (flag, index, source) => allowed.has(flag) && source.indexOf(flag) === index,
  );
  return normalized.includes("i") ? normalized.join("") : `${normalized.join("")}i`;
}

function safeRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
}
