import { normalizeApiBaseUrl, withDefaultApiPath } from "@/api/client/base-url";

/** Misty is hosted only, so every client uses the one Hosted namespace. */
const hostedScope = "hosted";
let officialAppRuntimeApiBase = "";

/** Configures the API origin for a separately packaged official app. */
export function configureOfficialAppRuntimeApiBase(apiBase: string): void {
  officialAppRuntimeApiBase = normalizeApiBaseUrl(apiBase) ?? "";
}

export function readDeploymentScope(): string {
  return hostedScope;
}

export function deploymentStorageKey(key: string): string {
  return `${key}:${hostedScope}`;
}

/** Reads the namespaced key, falling back to the pre-namespacing key so
 * existing installations retain their local state. */
export function readDeploymentStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(deploymentStorageKey(key)) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function resolveApiBase(): Promise<string> {
  return officialAppRuntimeApiBase || resolveHostedApiBase();
}

export function resolveHostedApiBase(): string {
  const base =
    normalizeApiBaseUrl(import.meta.env.VITE_MISTY_PUBLIC_API_URL) ??
    normalizeApiBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL) ??
    normalizeApiBaseUrl(import.meta.env.VITE_API_BASE) ??
    // compose.dev.yml publishes the Go API on loopback port 8081. Desktop
    // development should not depend on the public Cloudflare tunnel, which is
    // still used by remote callbacks and the collaboration Worker.
    (import.meta.env.DEV ? "http://127.0.0.1:8081/v1" : null);
  return withDefaultApiPath(base);
}
