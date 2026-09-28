import { httpRequest } from "./client/http";
import { onRateLimitRecovery } from "./client/rateLimit";
import { parseRetryAfter } from "./client/errors";
import {
  apiRequestCredentials,
  readApiAuthToken,
  readApiSessionGeneration,
} from "./client/session";
import { readDeploymentScope, resolveApiBase } from "./deployment/api";

export interface AccountEvent {
  topic: string;
  id?: string;
}
type Subscriber = (event: AccountEvent) => void;
interface Subscription {
  listeners: Set<Subscriber>;
  controller: AbortController;
}
const subscriptions = new Map<string, Subscription>();

/** One connection per account/deployment across cooperating same-origin windows.
 * Web Locks elect a leader; BroadcastChannel fans out committed invalidations.
 * Without those APIs there is still only one connection per renderer.
 */
export function subscribeAccountEvents(accountId: string, listener: Subscriber): () => void {
  if (!accountId) return () => {};
  const generation = readApiSessionGeneration();
  const channelKey = JSON.stringify([readDeploymentScope(), accountId]);
  const key = JSON.stringify([channelKey, generation]);
  let subscription = subscriptions.get(key);
  if (!subscription) {
    subscription = { listeners: new Set(), controller: new AbortController() };
    subscriptions.set(key, subscription);
    const current = subscription;
    const dispatch = (event: AccountEvent) => {
      if (current.controller.signal.aborted || generation !== readApiSessionGeneration()) return;
      for (const callback of current.listeners) callback(event);
    };
    const stopRecovery = onRateLimitRecovery(() => dispatch({ topic: "reset" }));
    current.controller.signal.addEventListener("abort", stopRecovery, { once: true });
    void coordinate(channelKey, current.controller.signal, generation, dispatch).catch(() => {});
  }
  subscription.listeners.add(listener);
  const current = subscription;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      current.controller.abort();
      if (subscriptions.get(key) === current) subscriptions.delete(key);
    }
  };
}

async function coordinate(
  key: string,
  signal: AbortSignal,
  generation: number,
  dispatch: Subscriber,
) {
  const shared = typeof BroadcastChannel !== "undefined" && navigator.locks;
  const channel = shared ? new BroadcastChannel(`misty:account-events:${key}`) : null;
  if (channel)
    channel.onmessage = (message: MessageEvent<AccountEvent>) => {
      if (validEvent(message.data)) dispatch(message.data);
    };
  const deliver = (event: AccountEvent) => {
    dispatch(event);
    channel?.postMessage(event);
  };
  try {
    if (shared)
      await navigator.locks.request(`misty:account-events:${key}`, { signal }, () =>
        stream(signal, generation, deliver),
      );
    else await stream(signal, generation, deliver);
  } finally {
    channel?.close();
  }
}

function validEvent(value: unknown): value is AccountEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as AccountEvent;
  return (
    [
      "settings-profiles",
      "reset",
      "runs",
      "invocations",
      "jobs",
      "agents",
      "approvals",
      "interventions",
    ].includes(event.topic) &&
    (event.id === undefined || (typeof event.id === "string" && event.id.length <= 200))
  );
}

async function stream(signal: AbortSignal, generation: number, deliver: Subscriber) {
  let failures = 0;
  while (!signal.aborted && generation === readApiSessionGeneration()) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let delay = Math.min(60_000, 1_000 * 2 ** Math.min(failures++, 6)) + Math.random() * 1_000;
    try {
      const [base, token] = await Promise.all([resolveApiBase(), readApiAuthToken()]);
      if (!base || signal.aborted || generation !== readApiSessionGeneration()) return;
      const headers = new Headers({ Accept: "text/event-stream" });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await httpRequest(`${base}/misty/events`, {
        headers,
        signal,
        credentials: apiRequestCredentials(),
      });
      delay = Math.max(delay, parseRetryAfter(response.headers.get("Retry-After")) ?? 0);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) return;
        if (response.status === 404) delay = Math.max(delay, 60_000);
        throw new Error("Event stream unavailable");
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const connectedAt = Date.now();
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        if (buffer.length > 65_536) throw new Error("Invalid event stream");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5))
            .join("\n");
          if (data) {
            const event: unknown = JSON.parse(data);
            if (validEvent(event)) deliver(event);
          }
        }
        if (Date.now() - connectedAt > 30_000) failures = 0;
      }
    } catch {
      /* Reconnect observes durable state; it never replays an action. */
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
    await waitForEventRetry(delay, signal);
  }
}

export function waitForEventRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Coalesce bursts and serialize snapshot reads. One trailing refresh closes
 * the race when a state change arrives during an in-flight snapshot.
 */
export function observeAccountChanges(
  accountId: string,
  topics: string[],
  refresh: () => Promise<unknown>,
): () => void {
  let disposed = false,
    busy = false,
    dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (disposed || busy) return;
    busy = true;
    dirty = false;
    try {
      await refresh();
    } catch {
      /* Consumers retain their existing error UI. */
    } finally {
      busy = false;
      if (dirty && !disposed) schedule();
    }
  };
  const schedule = () => {
    dirty = true;
    if (!busy && !timer)
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, 250);
  };
  const remove = subscribeAccountEvents(accountId, (event) => {
    if (event.topic === "reset" || topics.includes(event.topic)) schedule();
  });
  window.addEventListener("online", schedule);
  window.addEventListener("focus", schedule);
  if (accountId) void run();
  return () => {
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener("online", schedule);
    window.removeEventListener("focus", schedule);
    remove();
  };
}
