const SAME_ORIGIN_API_BASE = "/api";

export function resolveApiBase(rawApiBase = import.meta.env.VITE_API_BASE) {
  const configuredApiBase = rawApiBase?.trim().replace(/\/+$/, "");
  return configuredApiBase || SAME_ORIGIN_API_BASE;
}

export const apiBase = resolveApiBase();
