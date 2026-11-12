// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * Cross-session memory for the context gauge's denominator.
 *
 * A model's real window only ever arrives with an engine report (for Claude, the
 * `modelUsage` map on a turn's result line), so a brand-new chat has nothing to
 * measure against until its first turn ends. Remembering the last reported window per
 * engine+model slot lets the next session start at the right scale.
 *
 * localStorage-backed and best effort, a per-device convenience: a missing or
 * throwing storage just means the window reads as unknown.
 */
import { parseUsage } from "./usage";

const PREFIX = "misty.context-window";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function cacheKey(engine: string, model: string | null | undefined): string {
  return `${PREFIX}.${engine}.${model || "default"}`;
}

/** Record the window an engine just reported for this engine+model slot. */
export function rememberContextWindow(
  engine: string,
  model: string | null | undefined,
  window: number,
): void {
  if (!engine || !(window > 0)) return;
  try {
    storage()?.setItem(cacheKey(engine, model), String(window));
  } catch {
    // Private mode or quota: the window just reads as unknown next time.
  }
}

/** The last window this engine+model slot reported, if any. */
export function recallContextWindow(
  engine: string,
  model: string | null | undefined,
): number | undefined {
  if (!engine) return undefined;
  try {
    const raw = storage()?.getItem(cacheKey(engine, model));
    const n = raw ? Number(raw) : 0;
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** The gauge's denominator: a live report wins, then the remembered window,
 *  then the model catalog. Nothing known is undefined, never a guess. */
export function resolveContextMax(opts: {
  usage: unknown;
  engine: string;
  model?: string | null;
  catalogWindow?: number | null;
}): number | undefined {
  return (
    parseUsage(opts.usage)?.contextWindow ||
    recallContextWindow(opts.engine, opts.model) ||
    opts.catalogWindow ||
    undefined
  );
}
