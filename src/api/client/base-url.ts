/**
 * API configuration values are full API bases. Versioned paths such as
 * /api/v2 and /v1 are preserved verbatim. Origin-only values remain supported
 * for older desktop settings and receive the legacy /api default.
 */
export function normalizeApiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

export function withDefaultApiPath(base: string | null): string {
  if (!base) return "";
  return /\/(?:api(?:\/v\d+)?|v\d+)$/i.test(base) ? base : `${base}/api`;
}

/**
 * Whether this build may use a server at this address. A release build only talks to an https
 * domain: never plain http, an IP address or this computer. A development build takes those too.
 */
export function isAllowedServerUrl(value: string): boolean {
  if (import.meta.env.DEV) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    return (
      url.protocol === "https:" &&
      host.includes(".") &&
      !host.endsWith(".localhost") &&
      !/^[\d.]+$/.test(host)
    );
  } catch {
    return false;
  }
}
