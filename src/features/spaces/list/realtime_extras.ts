type Listener = (message: Record<string, unknown>) => void;

const listeners = new Map<string, Set<Listener>>();
const openListeners = new Set<() => void>();
let sender: ((payload: string) => boolean) | null = null;

export function onRealtimeMessage(type: string, listener: Listener): () => void {
  const set = listeners.get(type) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(type, set);
  return () => set.delete(listener);
}

export function onRealtimeOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

export function sendRealtimeMessage(message: Record<string, unknown>): boolean {
  return sender ? sender(JSON.stringify(message)) : false;
}

export function dispatchRealtimeExtra(message: { type?: unknown }): boolean {
  const set = typeof message.type === "string" ? listeners.get(message.type) : undefined;
  if (!set?.size) return false;
  for (const listener of set) listener(message as Record<string, unknown>);
  return true;
}

export function setRealtimeSender(next: ((payload: string) => boolean) | null) {
  sender = next;
  if (next) for (const listener of openListeners) listener();
}
