// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
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

export function rememberContextWindow(
  engine: string,
  model: string | null | undefined,
  window: number,
): void {
  if (!engine || !(window > 0)) return;
  try {
    storage()?.setItem(cacheKey(engine, model), String(window));
  } catch {}
}

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
