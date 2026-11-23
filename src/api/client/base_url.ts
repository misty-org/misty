export function normalizeApiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

export function withDefaultApiPath(base: string | null): string {
  if (!base) return "";
  return /\/v\d+$/i.test(base) ? base : `${base.replace(/\/api$/i, "")}/v1`;
}

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
