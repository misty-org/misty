import { uiRuleIds, type UiRuleId, type UiViolationMap } from "./ui_rule_definitions.ts";

export const uiExceptionsBaselinePath =
  "src/tests/architecture/fixtures/ui-exceptions-baseline.json";

export interface UiBaseline {
  rules: string[];
  locked: string[];
  files: Record<string, Record<string, number>>;
}

export function parseUiBaseline(json: unknown): UiBaseline {
  const value = (json ?? {}) as Record<string, unknown>;
  if (Array.isArray(value.rules) && value.files && typeof value.files === "object") {
    return {
      rules: value.rules as string[],
      locked: Array.isArray(value.locked) ? (value.locked as string[]) : [],
      files: value.files as UiBaseline["files"],
    };
  }
  return { rules: [], locked: [], files: {} };
}

interface BaselineUpdate {
  baseline: UiBaseline;
  newRules: Partial<Record<UiRuleId, number>>;
  refused: string[];
  lowered: string[];
}

export function nextUiBaseline(previous: UiBaseline, found: UiViolationMap): BaselineUpdate {
  const known = new Set(previous.rules.filter((id) => uiRuleIds.includes(id as UiRuleId)));
  const locked = new Set(previous.locked);
  const files: UiBaseline["files"] = {};
  const newRules: BaselineUpdate["newRules"] = {};
  const refused: string[] = [];
  const lowered: string[] = [];

  for (const [path, counts] of Object.entries(found)) {
    for (const [id, count] of Object.entries(counts) as [UiRuleId, number][]) {
      if (!known.has(id)) newRules[id] = (newRules[id] ?? 0) + count;
      const allowed = known.has(id) && !locked.has(id) ? (previous.files[path]?.[id] ?? 0) : 0;
      if (count > allowed) refused.push(`${path}: ${id} ${count} (allowed ${allowed})`);
      const keep = Math.min(count, allowed);
      if (keep > 0) (files[path] ??= {})[id] = keep;
    }
  }
  for (const [path, counts] of Object.entries(previous.files)) {
    for (const [id, allowed] of Object.entries(counts)) {
      const now = files[path]?.[id] ?? 0;
      if (known.has(id) && now < allowed) lowered.push(`${path}: ${id} ${allowed} → ${now}`);
    }
  }
  const held = new Set(Object.values(files).flatMap((counts) => Object.keys(counts)));
  const nowLocked = uiRuleIds.filter((id) => !held.has(id)).sort();

  const sortedFiles = Object.fromEntries(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, counts]) => [
        path,
        Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );
  return {
    baseline: { rules: [...uiRuleIds], locked: nowLocked, files: sortedFiles },
    newRules,
    refused,
    lowered,
  };
}

export function uiRuleTotals(files: Record<string, Partial<Record<string, number>>>) {
  const totals: Record<string, { hits: number; files: number }> = {};
  for (const id of uiRuleIds) totals[id] = { hits: 0, files: 0 };
  for (const counts of Object.values(files)) {
    for (const [id, count] of Object.entries(counts)) {
      if (!count || !totals[id]) continue;
      totals[id].hits += count;
      totals[id].files += 1;
    }
  }
  return totals;
}
