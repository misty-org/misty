/**
 * Tab switches hand the screen from one native page to the next. The old page
 * stays up until the new one is presented, then goes away immediately; the
 * timer only covers a new page that never arrives.
 */
// Longer than the native first-paint hold, so a slow page never leaves a gap.
const HANDOFF_FALLBACK_MS = 2500;

type PendingHide = { timer: number; run: () => void };

const pendingHides = new Map<string, PendingHide>();

/** Schedules `run` for when another page is presented, or after the fallback. */
export function deferHideUntilHandoff(id: string, run: () => void): void {
  cancelDeferredHide(id);
  const timer = window.setTimeout(() => releaseDeferredHide(id), HANDOFF_FALLBACK_MS);
  pendingHides.set(id, { timer, run });
}

/** The tab came back, or its runtime closed: it must not be hidden any more. */
export function cancelDeferredHide(id: string): void {
  const pending = pendingHides.get(id);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingHides.delete(id);
}

function releaseDeferredHide(id: string): void {
  const pending = pendingHides.get(id);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingHides.delete(id);
  pending.run();
}

export function hasPendingHandoff(): boolean {
  return pendingHides.size > 0;
}

/** A page was just presented: every page waiting to make way can go now. */
export function completeHandoff(presentedId: string): void {
  for (const id of [...pendingHides.keys()]) {
    if (id !== presentedId) releaseDeferredHide(id);
  }
}

/**
 * Opt-in timing for tab switches and creations: set
 * `localStorage.mistyBrowserPerf = "1"` and read the console. Times are in ms
 * from the first mark of each tab's current switch.
 */
const perfStarts = new Map<string, number>();

function perfEnabled(): boolean {
  try {
    return window.localStorage.getItem("mistyBrowserPerf") === "1";
  } catch {
    return false;
  }
}

export function markBrowserPerf(id: string, step: string, restart = false): void {
  if (!perfEnabled()) return;
  const now = performance.now();
  if (restart || !perfStarts.has(id)) perfStarts.set(id, now);
  const elapsed = Math.round(now - (perfStarts.get(id) ?? now));
  console.debug(`[browser-perf] ${id} +${elapsed}ms ${step}`);
}
