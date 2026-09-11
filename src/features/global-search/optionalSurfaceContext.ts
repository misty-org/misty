import type { AiSurfaceAdapter } from "@/features/ai-surface/types";

/** Optional render-time context is all-or-nothing; execution still uses guarded callbacks. */
export function readOptionalSurfaceContext(adapter?: AiSurfaceAdapter) {
  try {
    const context = adapter?.getContext() ?? [];
    const selection = adapter?.getSelection?.() ?? null;
    return { context, selection };
  } catch {
    // Permission denial and expired registrations are normal lifecycle states.
    // Do not retain a partial snapshot if access disappeared between callbacks.
    return { context: [], selection: null };
  }
}
