/**
 * API configuration values are full API bases, such as https://api.mistysys.com/v1. A server
 * answers only under /v1, so older settings that saved the bare origin or the retired /api
 * prefix get /v1 instead.
 */
export function normalizeApiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

export function withDefaultApiPath(base: string | null): string {
  if (!base) return "";
  return /\/v\d+$/i.test(base) ? base : `${base.replace(/\/api$/i, "")}/v1`;
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
