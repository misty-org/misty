import { uiRuleIds, type UiRuleId, type UiViolationMap } from "./uiRuleDefinitions.ts";

/**
 * The baseline: the rules it knows and, per file, how many times each still fires. Counts may
 * only go down.
 *
 * Runs under plain Node with uiRules.ts, so it imports nothing but Node itself.
 */

export const uiExceptionsBaselinePath =
  "src/tests/architecture/fixtures/ui-exceptions-baseline.json";

export interface UiBaseline {
  /** Every rule the baseline has a starting point for. A rule missing here is new. */
  rules: string[];
  files: Record<string, Record<string, number>>;
}

/** Reads the baseline, including the old `{path: ruleId[]}` shape, which knew no rule counts. */
export function parseUiBaseline(json: unknown): UiBaseline {
  const value = (json ?? {}) as Record<string, unknown>;
  if (Array.isArray(value.rules) && value.files && typeof value.files === "object") {
    return { rules: value.rules as string[], files: value.files as UiBaseline["files"] };
  }
  // The old shape: every rule is new to the count-based baseline.
  return { rules: [], files: {} };
}

export interface BaselineUpdate {
  baseline: UiBaseline;
  /** Rules recorded for the first time, with how many hits each starts from. */
  newRules: Partial<Record<UiRuleId, number>>;
  /** Pairs found above the baseline for a rule it already knew: refused, never written. */
  refused: string[];
  /** Pairs lowered or removed because the code got better. */
  lowered: string[];
}

/**
 * The next baseline. A known rule's counts can only fall: a file that fires it more than the
 * baseline allows is refused, not recorded, so the baseline can't quietly grow. Only a rule the
 * baseline has never seen gets its current hits as its starting point.
 */
export function nextUiBaseline(previous: UiBaseline, found: UiViolationMap): BaselineUpdate {
  const known = new Set(previous.rules.filter((id) => uiRuleIds.includes(id as UiRuleId)));
  const files: UiBaseline["files"] = {};
  const newRules: BaselineUpdate["newRules"] = {};
  const refused: string[] = [];
  const lowered: string[] = [];

  for (const [path, counts] of Object.entries(found)) {
    for (const [id, count] of Object.entries(counts) as [UiRuleId, number][]) {
      let keep = count;
      if (known.has(id)) {
        const allowed = previous.files[path]?.[id] ?? 0;
        if (count > allowed) refused.push(`${path}: ${id} ${count} (baseline ${allowed})`);
        keep = Math.min(count, allowed);
      } else {
        newRules[id] = (newRules[id] ?? 0) + count;
      }
      if (keep > 0) (files[path] ??= {})[id] = keep;
    }
  }
  for (const [path, counts] of Object.entries(previous.files)) {
    for (const [id, allowed] of Object.entries(counts)) {
      const now = files[path]?.[id] ?? 0;
      if (known.has(id) && now < allowed) lowered.push(`${path}: ${id} ${allowed} → ${now}`);
    }
  }

  const sortedFiles = Object.fromEntries(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, counts]) => [
        path,
        Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );
  return { baseline: { rules: [...uiRuleIds], files: sortedFiles }, newRules, refused, lowered };
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
