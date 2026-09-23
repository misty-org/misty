import { parseRetryAfter } from "./errors";

const deadlines = new Map<string, number>();
const prefix = "misty:http-cooldown:v1:";
const recoveryEvent = "misty:http-cooldown";

function notifyCooldown(until: number) {
  window.dispatchEvent(new CustomEvent(recoveryEvent, { detail: until }));
}

/** A single refresh at expiry recovers invalidations received during cooldown. */
export function onRateLimitRecovery(refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let until = 0;
  const schedule = (value: number) => {
    if (!Number.isFinite(value) || value <= Date.now()) return;
    until = Math.max(until, value);
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        until = 0;
        refresh();
      },
      until - Date.now() + 100,
    );
  };
  const local = (event: Event) => schedule((event as CustomEvent<number>).detail);
  const remote = (event: StorageEvent) => {
    if (event.key?.startsWith(prefix)) schedule(Number(event.newValue));
  };
  window.addEventListener(recoveryEvent, local);
  window.addEventListener("storage", remote);
  return () => {
    clearTimeout(timer);
    window.removeEventListener(recoveryEvent, local);
    window.removeEventListener("storage", remote);
  };
}

function keys(input: RequestInfo | URL, init: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  return [url.origin, `${url.origin}:${(init.method ?? "GET").toUpperCase()}:${url.pathname}`];
}

function deadline(key: string): number {
  let saved = 0;
  try {
    saved = Number(localStorage.getItem(prefix + key)) || 0;
  } catch {
    /* Memory fallback. */
  }
  return Math.max(saved, deadlines.get(key) ?? 0);
}

/** Reject locally instead of queuing stale signed requests or replaying writes.
 * Shared storage propagates the cooldown to other same-origin app windows.
 */
export function rateLimitResponse(input: RequestInfo | URL, init: RequestInit): Response | null {
  const until = Math.max(...keys(input, init).map(deadline));
  if (until <= Date.now()) return null;
  notifyCooldown(until);
  const seconds = Math.ceil((until - Date.now()) / 1000);
  return new Response(`Requests are cooling down. Try again in ${seconds} seconds.`, {
    status: 429,
    headers: { "Retry-After": String(seconds), "X-Misty-Local-Cooldown": "true" },
  });
}

export function recordRateLimit(input: RequestInfo | URL, init: RequestInit, response: Response) {
  if (response.status !== 429) return;
  const [origin, route] = keys(input, init);
  // Older servers do not identify scope. Conservatively stop traffic to that
  // API origin rather than accumulating strikes on an unknown global limit.
  const key = response.headers.get("X-Misty-RateLimit-Scope") === "route" ? route : origin;
  const until = Math.max(
    deadline(key),
    Date.now() + (parseRetryAfter(response.headers.get("Retry-After")) ?? 60_000),
  );
  deadlines.set(key, until);
  notifyCooldown(until);
  try {
    localStorage.setItem(prefix + key, String(until));
  } catch {
    /* Memory fallback. */
  }
}
