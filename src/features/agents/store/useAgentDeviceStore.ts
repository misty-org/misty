import { invoke } from "@tauri-apps/api/core";
import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { devicesApi } from "@/api/devices/api";
import type { AgentDevice } from "../model/interfaces/types";
import { ManagedAiRequestError } from "./useAiServerStore";

const serverDevicePrefix = "misty:agents:server-device:";
const localDeviceByServerId = new Map<string, string>();
const identityCache = new Map<string, StoredDeviceIdentity>();
const identityLoadAttempts = new Map<string, Promise<StoredDeviceIdentity>>();
const lastHeartbeatByServerId = new Map<string, number>();
const heartbeatIntervalMs = 30_000;
export const browserDeviceSessionId =
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `browser-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const agentDeviceCapabilities = {
  document_intelligence: true,
  folder_agents: true,
  job_leases: true,
  citations: true,
  connected_devices: true,
  browser_tools: true,
  browser_session_id: browserDeviceSessionId,
} as const;

/**
 * Returns the server-side execution identity for this local Misty device.
 * The opaque public identifier is stable per local device and contains no path
 * or host metadata. Account authentication still protects every device call.
 */
export async function ensureServerAgentDevice(
  local: AgentDevice,
  connected?: { endpointId: string; platform: "macos" | "windows" | "unknown" },
): Promise<ServerTrustedDevice> {
  let identity = await loadOrCreateDeviceIdentity(local.id);
  let publicKey = identity.publicKey;

  // Registration is an upsert. When Connected Devices starts, repeat it so
  // the shared trusted-device record receives the separate iroh identity even
  // if the Agent worker already registered this machine earlier in the session.
  if (connected) {
    const registered = await registerServerDevice(local, publicKey, connected);
    writeStorage(serverDevicePrefix + local.id, registered.id);
    localDeviceByServerId.set(registered.id, local.id);
    lastHeartbeatByServerId.set(registered.id, Date.now());
    return registered;
  }
  const cachedId = readStorage(serverDevicePrefix + local.id);
  if (cachedId) {
    if (Date.now() - (lastHeartbeatByServerId.get(cachedId) ?? 0) < heartbeatIntervalMs) {
      localDeviceByServerId.set(cachedId, local.id);
      return { id: cachedId, name: local.displayName };
    }
    try {
      localDeviceByServerId.set(cachedId, local.id);
      const heartbeat = await heartbeatServerAgentDevice(cachedId, local.id);
      return heartbeat;
    } catch (error) {
      if (
        !(error instanceof ManagedAiRequestError) ||
        (error.status !== 401 && error.status !== 404)
      )
        throw error;
      if (error.status === 401) {
        // A signed heartbeat can fail after the OS keychain is restored,
        // cleared, or contains a partial legacy identity. Prove account auth is
        // still valid before rotating anything; otherwise preserve the binding
        // and let the normal sign-in recovery handle the unauthorized session.
        await devicesApi.list<ServerDeviceList>();
      }
      removeStorage(serverDevicePrefix + local.id);
      localDeviceByServerId.delete(cachedId);
      identity = await rotateDeviceIdentity(local.id);
      publicKey = identity.publicKey;
    }
  }

  const list = await devicesApi.list<ServerDeviceList>().catch(() => ({ devices: [] }));
  const existing = list.devices.find(
    (device) => device.publicKey === publicKey && !device.revokedAt,
  );
  if (existing) {
    writeStorage(serverDevicePrefix + local.id, existing.id);
    localDeviceByServerId.set(existing.id, local.id);
    return heartbeatServerAgentDevice(existing.id, local.id);
  }

  const registered = await registerServerDevice(local, publicKey);
  writeStorage(serverDevicePrefix + local.id, registered.id);
  localDeviceByServerId.set(registered.id, local.id);
  lastHeartbeatByServerId.set(registered.id, Date.now());
  return registered;
}

async function registerServerDevice(
  local: AgentDevice,
  publicKey: string,
  connected?: { endpointId: string; platform: "macos" | "windows" | "unknown" },
): Promise<ServerTrustedDevice> {
  return devicesApi.register<ServerTrustedDevice>({
    name: local.displayName || "This Misty",
    publicKey,
    keyAlgorithm: "ed25519",
    platform: connected?.platform ?? "unknown",
    p2pEndpointId: connected?.endpointId ?? "",
    protocolVersions: connected ? ["misty-device/1"] : [],
    capabilities: agentDeviceCapabilities,
  });
}

export async function heartbeatServerAgentDevice(
  deviceId: string,
  localDeviceId = localDeviceByServerId.get(deviceId),
): Promise<ServerTrustedDevice> {
  if (!localDeviceId) throw new Error("Local device signing identity is unavailable.");
  const device = await devicesApi.heartbeat<ServerTrustedDevice>(
    signedAgentDeviceRequest,
    localDeviceId,
    deviceId,
    { capabilities: agentDeviceCapabilities },
  );
  lastHeartbeatByServerId.set(deviceId, Date.now());
  return device;
}

export async function signedAgentDeviceRequest<T>(
  localDeviceId: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const identity = await loadOrCreateDeviceIdentity(localDeviceId);
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = toBase64(nonceBytes);
  const bodyDigest = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
  );
  const canonical = deviceSignaturePayload(method, path, timestamp, nonce, bodyDigest);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64(identity.privateKey).buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(canonical),
  );
  const headers = new Headers(init.headers);
  headers.set("X-Misty-Device-Timestamp", timestamp);
  headers.set("X-Misty-Device-Nonce", nonce);
  headers.set("X-Misty-Device-Signature", toBase64(new Uint8Array(signature)));
  const signedInit: RequestInit = { ...init, headers };
  if (init.body == null) delete signedInit.body;
  else signedInit.body = body;
  return devicesApi.request<T>(path, signedInit);
}

async function loadOrCreateDeviceIdentity(localDeviceId: string): Promise<StoredDeviceIdentity> {
  const cached = identityCache.get(localDeviceId);
  if (cached) return cached;
  const pending = identityLoadAttempts.get(localDeviceId);
  if (pending) return pending;
  const attempt = (async () => {
    const stored = await invoke<string | null>("agents_device_identity_load", { localDeviceId });
    if (stored) {
      const parsed = JSON.parse(stored) as StoredDeviceIdentity;
      if (parsed.publicKey && parsed.privateKey) {
        identityCache.set(localDeviceId, parsed);
        return parsed;
      }
    }
    return rotateDeviceIdentity(localDeviceId);
  })();
  // Keep a rejected attempt for the rest of this app session. The background
  // job poller must not reopen a Keychain permission prompt every few seconds
  // after the user denies or dismisses it. Restarting Misty is the retry path.
  identityLoadAttempts.set(localDeviceId, attempt);
  return attempt;
}

async function rotateDeviceIdentity(localDeviceId: string): Promise<StoredDeviceIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const identity: StoredDeviceIdentity = {
    publicKey: toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    privateKey: toBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))),
  };
  await invoke("agents_device_identity_store", {
    localDeviceId,
    encodedIdentity: JSON.stringify(identity),
  });
  identityCache.set(localDeviceId, identity);
  return identity;
}

export function deviceSignaturePayload(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyDigest: string,
): string {
  const pathname = path.split("?", 1)[0] || "/";
  const canonicalPath = `/api${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  return `${method.toUpperCase()}\n${canonicalPath}\n${timestamp}\n${nonce}\n${bodyDigest.toLowerCase()}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readStorage(key: string): string | null {
  try {
    return readDeploymentStorageItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(deploymentStorageKey(key), value);
  } catch {
    /* non-secret registration hint */
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(deploymentStorageKey(key));
  } catch {
    /* no-op */
  }
}

export interface ServerTrustedDevice {
  id: string;
  name: string;
  publicKey?: string;
  revokedAt?: string | null;
  platform?: string;
  p2pEndpointId?: string;
  protocolVersions?: string[];
}

export interface ServerDeviceList {
  devices: ServerTrustedDevice[];
}

export interface StoredDeviceIdentity {
  publicKey: string;
  privateKey: string;
}
