/**
 * API configuration values are full API bases. Versioned paths such as
 * /api/v2 are preserved verbatim. Origin-only values remain supported for
 * older desktop settings and receive the current /api default.
 */
export function normalizeApiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

export function withDefaultApiPath(base: string | null): string {
  if (!base) return "";
  return /\/api(?:\/v\d+)?$/i.test(base) ? base : `${base}/api`;
}
