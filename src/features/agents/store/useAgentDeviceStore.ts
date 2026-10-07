import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hostname, platform, version } from "@tauri-apps/plugin-os";
import { getVersion } from "@tauri-apps/api/app";
import { resolveApiBase } from "@/api/deployment/api";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { devicesApi } from "@/api/devices/api";
import { useUserStore } from "@/features/auth/core";
import { devicesNative, type DevicesView } from "@/native/devices";
import { secureId } from "@/shared/platform/secureId";
import type { AgentDevice } from "../model/interfaces/types";
import { ManagedAiRequestError } from "./useAiServerStore";

// One device identity (docs/design/devices/BRIEF.md). The device key lives in
// native code only: this module never sees private key material. It asks the
// native side to register the device and to sign each device request.

const lastHeartbeatByServerId = new Map<string, number>();
let started: { key: string; promise: Promise<DevicesView> } | null = null;
export let browserDeviceSessionId = secureId();

export const agentDeviceCapabilities = {
  document_intelligence: true,
  folder_agents: true,
  job_leases: true,
  citations: true,
  connected_devices: true,
  browser_tools: true,
  get browser_session_id() {
    return browserDeviceSessionId;
  },
} as const;

/** The signed-in account and API base the native device commands act for. */
export async function deviceAccount(): Promise<{ apiBase: string; accountId: string }> {
  const accountId = useUserStore.getState().me?.id;
  if (!accountId || isApiSessionTransitioning()) {
    throw new ManagedAiRequestError("Sign in to use this device.", 401, "account_session_changed");
  }
  return { apiBase: await resolveApiBase(), accountId };
}

async function defaultDeviceName(): Promise<string> {
  try {
    const name = (await hostname())?.replace(/\.local$/i, "").trim();
    if (name) return name.slice(0, 64);
  } catch {
    /* fall back below */
  }
  return "This Misty";
}

/** Registers this device (once per account session) and starts its channel,
 * LAN discovery and trust. Only the main window starts it; other windows read
 * the device the main window registered. */
export async function ensureDeviceStarted(): Promise<DevicesView> {
  const account = await deviceAccount();
  const key = JSON.stringify([account.apiBase, account.accountId, readApiSessionGeneration()]);
  if (getCurrentWindow().label !== "main") {
    const view = await devicesNative.view(account.accountId);
    if (!view.serverDeviceId) throw new Error("This device isn't registered with Misty yet.");
    return view;
  }
  if (started?.key === key) return started.promise;
  const promise = (async () =>
    devicesNative.start(account, {
      name: await defaultDeviceName(),
      platform: platform(),
      osVersion: String(version() ?? "").slice(0, 64),
      appVersion: await getVersion().catch(() => ""),
    }))();
  started = { key, promise };
  promise.catch(() => {
    if (started?.promise === promise) started = null;
  });
  return promise;
}

/**
 * Returns the server identity of this device. `local` scopes the native
 * keychain entry; the server id comes from the native registration.
 */
export async function ensureServerAgentDevice(
  local: AgentDevice,
  _connected?: unknown,
): Promise<ServerTrustedDevice> {
  if ("__TAURI_INTERNALS__" in window)
    browserDeviceSessionId = await invoke<string>("agent_browser_session_id");
  const view = await ensureDeviceStarted();
  if (!view.serverDeviceId) throw new Error("This device isn't registered with Misty yet.");
  lastHeartbeatByServerId.set(view.serverDeviceId, Date.now());
  return { id: view.serverDeviceId, name: local.displayName };
}

/** Records liveness the server confirmed another way (the device channel). */
export function noteServerAgentDeviceSeen(deviceId: string): void {
  lastHeartbeatByServerId.set(deviceId, Date.now());
}

export function serverAgentDeviceSeenWithin(deviceId: string, ms: number): boolean {
  return Date.now() - (lastHeartbeatByServerId.get(deviceId) ?? 0) < ms;
}

/** Only needed while the device channel is down: the channel keeps the
 * device's online window current on the server by itself. */
export async function heartbeatServerAgentDevice(
  deviceId: string,
  localDeviceId = "",
): Promise<ServerTrustedDevice> {
  const account = await deviceAccount();
  const view = await devicesNative.view(account.accountId).catch(() => null);
  if (view?.channel.connected) {
    lastHeartbeatByServerId.set(deviceId, Date.now());
    return { id: deviceId, name: "" };
  }
  const device = await devicesApi.heartbeat<ServerTrustedDevice>(
    signedAgentDeviceRequest,
    localDeviceId,
    deviceId,
    { capabilities: agentDeviceCapabilities },
  );
  lastHeartbeatByServerId.set(deviceId, Date.now());
  return device;
}

/** Sends one request signed by this device's native key. */
export async function signedAgentDeviceRequest<T>(
  _localDeviceId: string,
  path: string,
  init: RequestInit,
  assertCurrent?: () => void,
): Promise<T> {
  assertCurrent?.();
  init.signal?.throwIfAborted();
  const account = await deviceAccount();
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = toBase64(nonceBytes);
  const bodyDigest = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
  );
  const apiBasePath = new URL(account.apiBase).pathname;
  const signature = await devicesNative.signRequest(account, {
    method,
    path: canonicalDevicePath(path, apiBasePath),
    timestamp,
    nonce,
    bodyDigest,
  });
  assertCurrent?.();
  init.signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  headers.set("X-Misty-Device-Timestamp", timestamp);
  headers.set("X-Misty-Device-Nonce", nonce);
  headers.set("X-Misty-Device-Signature", signature);
  const signedInit: RequestInit = { ...init, headers };
  if (init.body == null) delete signedInit.body;
  else signedInit.body = body;
  const result = await devicesApi.request<T>(path, signedInit);
  assertCurrent?.();
  return result;
}

/** The full server path a device request is signed over. */
export function canonicalDevicePath(path: string, apiBasePath = "/api"): string {
  const pathname = path.split("?", 1)[0] || "/";
  const basePath = `/${apiBasePath}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return `${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/** The canonical request a device signs (kept for tests and diagnostics). */
export function deviceSignaturePayload(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyDigest: string,
  apiBasePath = "/api",
): string {
  return `${method.toUpperCase()}\n${canonicalDevicePath(path, apiBasePath)}\n${timestamp}\n${nonce}\n${bodyDigest.toLowerCase()}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
