/**
 * Coalesces snapshot reloads triggered by realtime events. Events that arrive
 * before a reload starts share it; events during a reload get exactly one
 * trailing reload, which waits for the first so reads never overlap. A burst
 * of N events for one target therefore costs at most two reads, not N.
 */
interface Slot {
  queued: Promise<void> | null;
  inFlight: Promise<unknown> | null;
}

const slots = new Map<string, Slot>();

export function coalescedReload(key: string, run: () => Promise<unknown>): Promise<void> {
  let slot = slots.get(key);
  if (!slot) {
    slot = { queued: null, inFlight: null };
    slots.set(key, slot);
  }
  const current = slot;
  if (current.queued) return current.queued;
  const queued = (async () => {
    // A microtask boundary lets events dispatched together share this read.
    await Promise.resolve();
    await current.inFlight?.catch(() => undefined);
    // From here on, new events need a later reload.
    if (current.queued === queued) current.queued = null;
    const read = run();
    current.inFlight = read;
    try {
      await read;
    } finally {
      if (current.inFlight === read) current.inFlight = null;
      if (!current.queued && !current.inFlight) slots.delete(key);
    }
  })();
  current.queued = queued;
  return queued;
}

/** Drops queued state, for account switches and tests. */
export function resetCoalescedReloads(): void {
  slots.clear();
}
