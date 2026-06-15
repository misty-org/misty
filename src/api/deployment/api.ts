import { normalizeApiBaseUrl, withDefaultApiPath } from "@/api/client/base-url";
import { appConfigureServer, appSnapshot } from "@/native";
import { deploymentHostLabel, rememberDeployment } from "./knownDeployments";

export type DeploymentMode = "hosted" | "self_hosted";

export interface InstanceDescriptor {
  server_id: string;
  name: string;
  deployment: DeploymentMode;
  protocol_version: number;
  min_client_protocol: number;
  max_client_protocol: number;
  capabilities: {
    collaboration: boolean;
    library: boolean;
    notes: boolean;
    drawings: boolean;
    hosted_billing: boolean;
    hosted_integrations: boolean;
    hosted_ai: boolean;
    storage_backend: string;
  };
  bootstrap_required: boolean;
  registration: "open" | "invitation" | "disabled";
}

export interface DeploymentTarget {
  mode: DeploymentMode;
  apiBase: string;
  scope: string;
  serverUrl: string | null;
}

export const selfHostedProtocolVersion = 1;
const deploymentScopeKey = "misty:deployment-scope";
let cachedTarget: Promise<DeploymentTarget> | null = null;
let officialAppRuntimeApiBase = "";

/** Configures the API origin for a separately packaged official app. */
export function configureOfficialAppRuntimeApiBase(apiBase: string): void {
  officialAppRuntimeApiBase = normalizeApiBaseUrl(apiBase) ?? "";
  cachedTarget = null;
}

export function readDeploymentScope(): string {
  try {
    return localStorage.getItem(deploymentScopeKey) || "hosted";
  } catch {
    return "hosted";
  }
}

export function deploymentStorageKey(key: string): string {
  return `${key}:${readDeploymentScope()}`;
}

/** Reads the active deployment namespace. Hosted alone may fall back to the
 * pre-namespacing key so existing installations retain their local state. */
export function readDeploymentStorageItem(key: string): string | null {
  try {
    const scoped = localStorage.getItem(deploymentStorageKey(key));
    if (scoped !== null) return scoped;
    return readDeploymentScope() === "hosted" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function resetDeploymentTargetCache(): void {
  cachedTarget = null;
}

export function resolveDeploymentTarget(): Promise<DeploymentTarget> {
  cachedTarget ??= loadDeploymentTarget();
  return cachedTarget;
}

export async function resolveApiBase(): Promise<string> {
  if (officialAppRuntimeApiBase) return officialAppRuntimeApiBase;
  return (await resolveDeploymentTarget()).apiBase;
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

export async function inspectSelfHostedServer(rawUrl: string): Promise<InstanceDescriptor> {
  const serverUrl = validateSelfHostedServerUrl(rawUrl);
  const response = await fetch(`${withDefaultApiPath(serverUrl)}/instance`, {
    credentials: "omit",
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Could not verify that server (${response.status}).`);
  const descriptor = (await response.json()) as InstanceDescriptor;
  if (descriptor.deployment !== "self_hosted") {
    throw new Error("That endpoint is not a self-hosted Misty server.");
  }
  if (
    !Number.isInteger(descriptor.protocol_version) ||
    !Number.isInteger(descriptor.min_client_protocol) ||
    !Number.isInteger(descriptor.max_client_protocol) ||
    selfHostedProtocolVersion < descriptor.min_client_protocol ||
    selfHostedProtocolVersion > descriptor.max_client_protocol
  ) {
    throw new Error("This Misty app is not compatible with that server version.");
  }
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(descriptor.server_id) || !descriptor.name?.trim()) {
    throw new Error("The server returned an incomplete instance descriptor.");
  }
  if (
    !descriptor.capabilities?.collaboration ||
    !descriptor.capabilities.library ||
    !descriptor.capabilities.notes ||
    !descriptor.capabilities.drawings
  ) {
    throw new Error("That server does not provide the core Misty collaboration features.");
  }
  return descriptor;
}

export async function fetchCurrentInstanceDescriptor(): Promise<InstanceDescriptor> {
  const target = await resolveDeploymentTarget();
  const response = await fetch(`${target.apiBase}/instance`, {
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Could not read the Misty instance (${response.status}).`);
  return (await response.json()) as InstanceDescriptor;
}

export async function saveDeploymentConfiguration(
  mode: DeploymentMode,
  rawUrl?: string,
  descriptor?: InstanceDescriptor,
): Promise<void> {
  const url = mode === "self_hosted" ? validateSelfHostedServerUrl(rawUrl ?? "") : null;
  const scope =
    mode === "hosted"
      ? "hosted"
      : `self-hosted-${stableScope(descriptor?.server_id || url || "unknown")}`;
  await appConfigureServer(
    mode,
    url,
    mode === "self_hosted" ? descriptor?.server_id : null,
    mode === "self_hosted" ? descriptor?.name : null,
  );
  try {
    localStorage.setItem(deploymentScopeKey, scope);
  } catch {
    // The native configuration remains authoritative; storage namespacing is best-effort.
  }
  if (url) {
    rememberDeployment({
      url,
      serverId: descriptor?.server_id ?? null,
      name: descriptor?.name?.trim() || deploymentHostLabel(url),
    });
  }
  resetDeploymentTargetCache();
}

export function validateSelfHostedServerUrl(rawUrl: string): string {
  const normalized = normalizeApiBaseUrl(rawUrl);
  if (!normalized) throw new Error("Enter a self-hosted Misty server URL.");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("The self-hosted server URL is invalid.");
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) {
    throw new Error("Self-hosted servers must use HTTPS unless they run on this device.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("The server URL cannot contain credentials, a query, or a fragment.");
  }
  return normalized;
}

async function loadDeploymentTarget(): Promise<DeploymentTarget> {
  try {
    const environment = (await appSnapshot()).environment;
    if (environment.serverMode === "self_hosted") {
      const serverUrl = validateSelfHostedServerUrl(environment.serverUrl ?? "");
      const scope = `self-hosted-${stableScope(environment.serverDeploymentId || serverUrl)}`;
      writeDeploymentScope(scope);
      // Installations configured before the switcher existed still deserve an
      // entry, so the server they are already on can be switched back to.
      rememberDeployment({
        url: serverUrl,
        serverId: environment.serverDeploymentId ?? null,
        name: environment.serverName?.trim() || deploymentHostLabel(serverUrl),
      });
      return {
        mode: "self_hosted",
        apiBase: withDefaultApiPath(serverUrl),
        scope,
        serverUrl,
      };
    }
  } catch {
    // Hosted web and older native builds do not expose an environment snapshot.
    // They must retain the existing build-time Hosted endpoint behavior.
  }
  writeDeploymentScope("hosted");
  return { mode: "hosted", apiBase: resolveHostedApiBase(), scope: "hosted", serverUrl: null };
}

function writeDeploymentScope(scope: string): void {
  try {
    localStorage.setItem(deploymentScopeKey, scope);
  } catch {
    // Native configuration remains authoritative for routing.
  }
}

function stableScope(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
