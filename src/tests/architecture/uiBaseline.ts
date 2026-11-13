import { uiRuleIds, type UiRuleId, type UiViolationMap } from "./uiRuleDefinitions.ts";

/**
 * The baseline: the rules it knows, the rules locked at zero, and, per file, how many times each
 * other rule still fires. Counts may only go down. A rule that reaches zero is locked and never
 * fires again; a new rule starts locked, so no rule ever gets a fresh allowance of debt.
 *
 * Runs under plain Node with uiRules.ts, so it imports nothing but Node itself.
 */

export const uiExceptionsBaselinePath =
  "src/tests/architecture/fixtures/ui-exceptions-baseline.json";

export interface UiBaseline {
  /** Every rule the baseline has a starting point for. A rule missing here is new. */
  rules: string[];
  /** Rules at zero for good: any hit fails, and no file may hold an exception for them. */
  locked: string[];
  files: Record<string, Record<string, number>>;
}

/** Reads the baseline, including the old `{path: ruleId[]}` shape, which knew no rule counts. */
export function parseUiBaseline(json: unknown): UiBaseline {
  const value = (json ?? {}) as Record<string, unknown>;
  if (Array.isArray(value.rules) && value.files && typeof value.files === "object") {
    return {
      rules: value.rules as string[],
      locked: Array.isArray(value.locked) ? (value.locked as string[]) : [],
      files: value.files as UiBaseline["files"],
    };
  }
  // The old shape: every rule is new to the count-based baseline.
  return { rules: [], locked: [], files: {} };
}

interface BaselineUpdate {
  baseline: UiBaseline;
  /** Rules seen for the first time: they start locked at zero, so any hits here are refused. */
  newRules: Partial<Record<UiRuleId, number>>;
  /** Pairs found above the baseline for a rule it already knew: refused, never written. */
  refused: string[];
  /** Pairs lowered or removed because the code got better. */
  lowered: string[];
}

/**
 * The next baseline. A known rule's counts can only fall: a file that fires it more than the
 * baseline allows is refused, not recorded, so the baseline can't quietly grow. A locked rule
 * (one that reached zero) and a rule new to the baseline allow nothing at all, so their hits are
 * refused too. Whatever is at zero afterwards is locked.
 */
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

/** Hits per rule across a violation map or baseline. */
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
