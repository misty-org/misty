import type { SavedSearchRule, SearchResult, SmartLibraryAsset } from "@/native/contracts";

export function aggregateTags(assets: SmartLibraryAsset[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const asset of assets)
    for (const tag of new Set(asset.tags)) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { name: current?.name ?? tag, count: (current?.count ?? 0) + 1 });
    }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
export function joinPath(root: string, relative: string) {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(relative)) return relative;
  return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`;
}
export function searchableRuleText(query: string, rules: SavedSearchRule[], mode: "all" | "any") {
  if (mode === "any") return "";
  const text = rules
    .filter((rule) => rule.field === "text" && rule.operator !== "is_not")
    .map((rule) => rule.value)
    .join(" ")
    .trim();
  return text || (rules.length === 0 ? query : "");
}
export function semanticRuleText(query: string, rules: SavedSearchRule[]) {
  return [
    query,
    ...rules
      .filter(
        (rule) => (rule.field === "tag" || rule.field === "text") && rule.operator !== "is_not",
      )
      .map((rule) => rule.value),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}
export function matchesRules(result: SearchResult, rules: SavedSearchRule[], mode: "all" | "any") {
  if (!rules.length) return true;
  const matches = rules.map((rule) => matchRule(result, rule));
  return mode === "any" ? matches.some(Boolean) : matches.every(Boolean);
}
function matchRule(result: SearchResult, rule: SavedSearchRule) {
  const entry = result.entry;
  const value = rule.value.trim().toLocaleLowerCase();
  if (!value) return true;
  let candidate = "";
  if (rule.field === "path") candidate = entry.path.toLocaleLowerCase();
  else if (rule.field === "kind") candidate = entry.kind.toLocaleLowerCase();
  else if (rule.field === "extension")
    candidate = entry.extension.replace(/^\./, "").toLocaleLowerCase();
  else if (rule.field === "hidden") return entry.hidden === (value === "true" || value === "yes");
  else if (rule.field === "size")
    return (
      entry.sizeBytes !== null && compareNumber(entry.sizeBytes, parseSize(value), rule.operator)
    );
  else if (rule.field === "modified")
    return (
      entry.modifiedMs !== null && compareNumber(entry.modifiedMs, Date.parse(value), rule.operator)
    );
  else if (rule.field === "tag")
    return (result.match?.tags ?? []).some((tag) =>
      compareText(tag.toLocaleLowerCase(), value, rule.operator),
    );
  else if (rule.field === "text")
    candidate = [entry.name, result.match?.description, ...(result.match?.tags ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
  else return true;
  return compareText(candidate, value, rule.operator);
}
function compareText(candidate: string, value: string, operator: string) {
  if (operator === "is") return candidate === value;
  if (operator === "is_not") return candidate !== value;
  if (operator === "starts_with") return candidate.startsWith(value);
  if (operator === "ends_with") return candidate.endsWith(value);
  return candidate.includes(value);
}
function compareNumber(candidate: number, target: number, operator: string) {
  if (!Number.isFinite(target)) return false;
  if (operator === "gt" || operator === "after") return candidate > target;
  if (operator === "lt" || operator === "before") return candidate < target;
  if (operator === "is_not") return candidate !== target;
  return candidate === target;
}
function parseSize(value: string) {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(kb|kib|mb|mib|gb|gib)?$/i);
  if (!match) return Number.NaN;
  const units: Record<string, number> = {
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
  };
  return Number(match[1]) * (units[(match[2] ?? "").toLocaleLowerCase()] ?? 1);
}
