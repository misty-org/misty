let fallbackSequence = 0;

/** A privacy-safe id used only to join client, API, and Worker diagnostics. */
export function newClientRequestID(): string {
  try {
    if (typeof crypto.randomUUID === "function") {
      return `desktop_${crypto.randomUUID()}`;
    }
  } catch {
    // The deterministic-shape fallback is sufficient for correlation.
  }
  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `desktop_${Date.now().toString(36)}_${fallbackSequence.toString(36)}`;
}

export function addRequestCorrelation(headers: Headers): Headers {
  if (!headers.has("X-Request-ID")) {
    headers.set("X-Request-ID", newClientRequestID());
  }
  return headers;
}
