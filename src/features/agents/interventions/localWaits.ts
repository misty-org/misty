import { emit, listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AgentInterventionWait } from "./api";

/**
 * Waits held on this computer: a tool call that stays open until the person answers. The window
 * running the tool may not be the window showing the chat, so the waits reach every window, and the
 * answer comes back to the one holding the call. A wait grants nothing: the agent must look again.
 */

const opened = "misty://agent-wait-opened";
const closed = "misty://agent-wait-closed";
const decided = "misty://agent-wait-decided";
const announce = "misty://agent-wait-announce";

type Answer = "ready" | "declined" | "expired";

const known = new Map<string, AgentInterventionWait>();
const held = new Map<string, (answer: Answer) => void>();
const listeners = new Set<() => void>();
let listening = false;

const changed = () => {
  for (const listener of listeners) listener();
};

function send(event: string, payload: unknown) {
  if (hasTauriInternals()) void emit(event, payload).catch(() => undefined);
}

export function listenForLocalWaits() {
  if (listening || !hasTauriInternals()) return;
  listening = true;
  void listen<AgentInterventionWait>(opened, ({ payload }) => {
    known.set(payload.id, payload);
    changed();
  }).catch(() => undefined);
  void listen<{ id: string }>(closed, ({ payload }) => {
    if (known.delete(payload.id)) changed();
  }).catch(() => undefined);
  void listen<{ id: string; ready: boolean }>(decided, ({ payload }) => {
    held.get(payload.id)?.(payload.ready ? "ready" : "declined");
  }).catch(() => undefined);
  // A window that opens mid-wait asks, and whoever holds a wait says so again.
  void listen(announce, () => {
    for (const id of held.keys()) {
      const wait = known.get(id);
      if (wait) send(opened, wait);
    }
  })
    .then(() => send(announce, {}))
    .catch(() => undefined);
}

export const localWaits = () => [...known.values()];

export function onLocalWaitsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The person's answer, from whichever window they gave it in. */
export function decideLocalWait(id: string, ready: boolean) {
  const holder = held.get(id);
  if (holder) holder(ready ? "ready" : "declined");
  else send(decided, { id, ready });
}

/** Shows the wait and holds until the person answers, it expires, or the run stops waiting. */
export function holdLocalWait(wait: AgentInterventionWait, signal: AbortSignal): Promise<Answer> {
  listenForLocalWaits();
  return new Promise((resolve) => {
    const finish = (answer: Answer) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      held.delete(wait.id);
      known.delete(wait.id);
      changed();
      send(closed, { id: wait.id });
      resolve(answer);
    };
    const stop = () => finish("expired");
    const timer = setTimeout(stop, Math.max(0, Date.parse(wait.expiresAt) - Date.now()));
    signal.addEventListener("abort", stop, { once: true });
    held.set(wait.id, finish);
    known.set(wait.id, wait);
    changed();
    send(opened, wait);
    if (signal.aborted) stop();
  });
}
