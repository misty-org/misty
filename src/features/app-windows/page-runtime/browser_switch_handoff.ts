const HANDOFF_FALLBACK_MS = 2500;

type PendingHide = { timer: number; run: () => void };

const pendingHides = new Map<string, PendingHide>();

export function deferHideUntilHandoff(id: string, run: () => void): void {
  cancelDeferredHide(id);
  const timer = window.setTimeout(() => releaseDeferredHide(id), HANDOFF_FALLBACK_MS);
  pendingHides.set(id, { timer, run });
}

export function cancelDeferredHide(id: string): void {
  const pending = pendingHides.get(id);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingHides.delete(id);
  if (!pendingHides.size) notifyBrowserSettled();
}

function releaseDeferredHide(id: string): void {
  const pending = pendingHides.get(id);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingHides.delete(id);
  pending.run();
  if (!pendingHides.size) notifyBrowserSettled();
}

export function hasPendingHandoff(): boolean {
  return pendingHides.size > 0;
}

const settledListeners = new Set<() => void>();

export function onBrowserSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => void settledListeners.delete(listener);
}

export function notifyBrowserSettled(): void {
  settledListeners.forEach((listener) => listener());
}

export function completeHandoff(presentedId: string): void {
  for (const id of [...pendingHides.keys()]) {
    if (id !== presentedId) releaseDeferredHide(id);
  }
}

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
