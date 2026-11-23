import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";

const realtimeCursorKey = "misty:spaces:realtime-cursor";
const seenEventsKept = 1_000;
const seenWriteDelayMs = 250;

interface WindowCursor {
  applied: number;
  floor: number;
  seen: Set<number>;
  pending: Set<number>;
  doubted: boolean;
}

interface StoredSeen {
  floor: number;
  seen: number[];
}

const cursors = new Map<string, WindowCursor>();
const seenWrites = new Map<string, ReturnType<typeof setTimeout>>();

function accountRealtimeCursorKey(accountId: string): string {
  return `${realtimeCursorKey}:${accountId}`;
}

function accountSeenEventsKey(accountId: string): string {
  return `${accountRealtimeCursorKey(accountId)}:seen`;
}

function storedRealtimeCursor(accountId: string): number {
  try {
    return Number(readDeploymentStorageItem(accountRealtimeCursorKey(accountId))) || 0;
  } catch {
    return 0;
  }
}

function storedSeenEvents(accountId: string, applied: number): StoredSeen {
  try {
    const raw = readDeploymentStorageItem(accountSeenEventsKey(accountId));
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredSeen>) : null;
    const floor = Number(parsed?.floor);
    if (!parsed || !Number.isSafeInteger(floor) || floor < 0 || !Array.isArray(parsed.seen))
      return { floor: applied, seen: [] };
    return {
      floor: Math.min(floor, applied),
      seen: parsed.seen.filter((id): id is number => Number.isSafeInteger(id) && id > floor),
    };
  } catch {
    return { floor: applied, seen: [] };
  }
}

function windowCursor(accountId: string): WindowCursor {
  let cursor = cursors.get(accountId);
  if (!cursor) {
    const applied = storedRealtimeCursor(accountId);
    const stored = storedSeenEvents(accountId, applied);
    cursor = {
      applied,
      floor: stored.floor,
      seen: new Set(stored.seen),
      pending: new Set(),
      doubted: false,
    };
    cursors.set(accountId, cursor);
  }
  return cursor;
}

export function readRealtimeCursor(accountId: string): number {
  return windowCursor(accountId).applied;
}

export function beginRealtimeEvent(accountId: string, eventId: number): boolean {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return false;
  const cursor = windowCursor(accountId);
  if (cursor.seen.has(eventId)) return false;
  if (cursor.doubted && eventId <= cursor.applied)
    moveRealtimeCursor(accountId, cursor, eventId - 1);
  else if (eventId <= cursor.floor) return false;
  cursor.doubted = false;
  cursor.seen.add(eventId);
  cursor.pending.add(eventId);
  keepSeenBounded(cursor);
  return true;
}

export function finishRealtimeEvent(accountId: string, eventId: number): void {
  const cursor = cursors.get(accountId);
  if (!cursor || !cursor.pending.delete(eventId)) return;
  let lowestPending = Infinity;
  for (const waiting of cursor.pending)
    if (waiting > cursor.applied) lowestPending = Math.min(lowestPending, waiting);
  let next = cursor.applied;
  for (const done of cursor.seen)
    if (done < lowestPending && !cursor.pending.has(done)) next = Math.max(next, done);
  if (next <= cursor.applied) {
    scheduleSeenWrite(accountId);
    return;
  }
  cursor.applied = next;
  persistCursor(accountId, cursor);
}

export function resetRealtimeCursor(accountId: string, newest: number): void {
  if (!Number.isSafeInteger(newest) || newest < 0) return;
  const cursor = windowCursor(accountId);
  cursor.doubted = false;
  moveRealtimeCursor(accountId, cursor, newest);
}

export function doubtRealtimeCursor(accountId: string): void {
  windowCursor(accountId).doubted = true;
}

export function resetRealtimeCursors(): void {
  for (const [accountId, timer] of seenWrites) {
    clearTimeout(timer);
    const cursor = cursors.get(accountId);
    if (cursor) writeSeenEvents(accountId, cursor);
  }
  seenWrites.clear();
  cursors.clear();
}

function keepSeenBounded(cursor: WindowCursor) {
  if (cursor.seen.size <= seenEventsKept) return;
  const ordered = [...cursor.seen].sort((a, b) => a - b);
  for (const id of ordered) {
    if (cursor.seen.size <= seenEventsKept) break;
    if (cursor.pending.has(id)) continue;
    cursor.seen.delete(id);
    cursor.floor = Math.max(cursor.floor, id);
  }
}

function moveRealtimeCursor(accountId: string, cursor: WindowCursor, applied: number) {
  cursor.applied = Math.max(0, applied);
  cursor.floor = cursor.applied;
  cursor.pending.clear();
  cursor.seen.clear();
  persistCursor(accountId, cursor);
}

function persistCursor(accountId: string, cursor: WindowCursor) {
  const timer = seenWrites.get(accountId);
  if (timer !== undefined) {
    clearTimeout(timer);
    seenWrites.delete(accountId);
  }
  writeSeenEvents(accountId, cursor);
  writeRealtimeCursor(accountId, cursor.applied);
}

function scheduleSeenWrite(accountId: string) {
  if (seenWrites.has(accountId)) return;
  seenWrites.set(
    accountId,
    setTimeout(() => {
      seenWrites.delete(accountId);
      const cursor = cursors.get(accountId);
      if (cursor) writeSeenEvents(accountId, cursor);
    }, seenWriteDelayMs),
  );
}

function writeSeenEvents(accountId: string, cursor: WindowCursor) {
  const seen: number[] = [];
  for (const id of cursor.seen) if (!cursor.pending.has(id)) seen.push(id);
  try {
    window.localStorage.setItem(
      deploymentStorageKey(accountSeenEventsKey(accountId)),
      JSON.stringify({ floor: cursor.floor, seen } satisfies StoredSeen),
    );
  } catch {}
}

function writeRealtimeCursor(accountId: string, cursor: number) {
  try {
    window.localStorage.setItem(
      deploymentStorageKey(accountRealtimeCursorKey(accountId)),
      String(cursor),
    );
  } catch {}
}
