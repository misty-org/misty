/**
 * Realtime messages that belong to the account rather than a Space (a person's status, a call
 * ringing), handed to whichever feature listens for them, and messages a feature sends on the same
 * socket (this computer going idle). The Spaces realtime connection owns the socket.
 */
type Listener = (message: Record<string, unknown>) => void;

const listeners = new Map<string, Set<Listener>>();
const openListeners = new Set<() => void>();
let sender: ((payload: string) => boolean) | null = null;

/** Calls `listener` with every realtime message of this `type`; returns a function that stops it. */
export function onRealtimeMessage(type: string, listener: Listener): () => void {
  const set = listeners.get(type) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(type, set);
  return () => set.delete(listener);
}

/** Calls `listener` each time the realtime connection opens (again); returns a function that stops it. */
export function onRealtimeOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/** Sends a message on the realtime connection; false while it is closed. */
export function sendRealtimeMessage(message: Record<string, unknown>): boolean {
  return sender ? sender(JSON.stringify(message)) : false;
}

/** For the Spaces realtime connection: hands a message to its listeners; false if nobody takes it. */
export function dispatchRealtimeExtra(message: { type?: unknown }): boolean {
  const set = typeof message.type === "string" ? listeners.get(message.type) : undefined;
  if (!set?.size) return false;
  for (const listener of set) listener(message as Record<string, unknown>);
  return true;
}

/** For the Spaces realtime connection: how to send while it is open, or null once it closes. */
export function setRealtimeSender(next: ((payload: string) => boolean) | null) {
  sender = next;
  if (next) for (const listener of openListeners) listener();
}
