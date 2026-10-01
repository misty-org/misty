/**
 * Coalesces snapshot reloads triggered by realtime events. The first event
 * reloads at once; events that arrive while that read is in flight share one
 * trailing reload, which starts after it so reads never overlap. A burst of N
 * events for one target therefore costs at most two reads, not N.
 */
interface Slot {
  inFlight: Promise<void> | null;
  trailing: Promise<void> | null;
}

const slots = new Map<string, Slot>();

export function coalescedReload(key: string, run: () => Promise<unknown>): Promise<void> {
  let slot = slots.get(key);
  if (!slot) {
    slot = { inFlight: null, trailing: null };
    slots.set(key, slot);
  }
  const current = slot;
  const start = (): Promise<void> => {
    let read: Promise<void>;
    try {
      read = Promise.resolve(run()).then(() => undefined);
    } catch (error) {
      read = Promise.reject(error);
    }
    current.inFlight = read;
    const settle = () => {
      if (current.inFlight === read) current.inFlight = null;
      if (!current.inFlight && !current.trailing && slots.get(key) === current) slots.delete(key);
    };
    read.then(settle, settle);
    return read;
  };
  if (!current.inFlight) return start();
  if (!current.trailing) {
    current.trailing = current.inFlight
      .catch(() => undefined)
      .then(() => {
        current.trailing = null;
        return start();
      });
  }
  return current.trailing;
}

/** Drops queued state, for account switches and tests. */
export function resetCoalescedReloads(): void {
  slots.clear();
}
