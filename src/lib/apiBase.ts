const LOCAL_API_BASE = "http://localhost:8080/api";
const SAME_ORIGIN_API_BASE = "/api";

function isLocalhostHostname(hostname: string) {
  switch (hostname.trim().toLowerCase()) {
    case "localhost":
    case "127.0.0.1":
    case "::1":
      return true;
    default:
      return false;
  }
}

export function resolveApiBase(rawApiBase = import.meta.env.VITE_API_BASE) {
  const configuredApiBase = rawApiBase?.trim().replace(/\/+$/, "");
  if (configuredApiBase) {
    return configuredApiBase;
  }

  if (typeof window !== "undefined" && isLocalhostHostname(window.location.hostname)) {
    return LOCAL_API_BASE;
  }

  return SAME_ORIGIN_API_BASE;
}

export const apiBase = resolveApiBase();
