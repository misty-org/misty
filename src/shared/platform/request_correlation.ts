let fallbackSequence = 0;

export function newClientRequestID(): string {
  try {
    if (typeof crypto.randomUUID === "function") {
      return `desktop_${crypto.randomUUID()}`;
    }
  } catch {}
  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `desktop_${Date.now().toString(36)}_${fallbackSequence.toString(36)}`;
}

export function addRequestCorrelation(headers: Headers): Headers {
  if (!headers.has("X-Request-ID")) {
    headers.set("X-Request-ID", newClientRequestID());
  }
  return headers;
}
