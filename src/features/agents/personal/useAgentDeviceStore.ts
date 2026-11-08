import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform, version } from "@tauri-apps/plugin-os";
import { getVersion } from "@tauri-apps/api/app";
import { resolveApiBase } from "@/api/deployment/api";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { useUserStore } from "@/features/account/core";
import { devicesNative, type DevicesView } from "@/features/devices";
import type { AgentDevice } from "./agentScope";
import { ManagedAiRequestError } from "../../../api/managed/managed";
import { isProfileWindowLabel } from "@/features/app-windows";

// One device identity. The device key lives in
// native code only: this module never sees private key material. It asks the
// native side to register the device and to sign each device request.

let started: { key: string; promise: Promise<DevicesView> } | null = null;

/** The signed-in account and API base the native device commands act for. */
export async function deviceAccount(): Promise<{ apiBase: string; accountId: string }> {
  const accountId = useUserStore.getState().me?.id;
  if (!accountId || isApiSessionTransitioning()) {
    throw new ManagedAiRequestError("Sign in to use agents here.", 401, "account_session_changed");
  }
  return { apiBase: await resolveApiBase(), accountId };
}

/** Registers this device (once per account session) and starts its channel
 * and trust. Only the main window starts it; other windows read
 * the device the main window registered. */
export async function ensureDeviceStarted(): Promise<DevicesView> {
  const account = await deviceAccount();
  const key = JSON.stringify([account.apiBase, account.accountId, readApiSessionGeneration()]);
  if (!isProfileWindowLabel(getCurrentWindow().label)) {
    const view = await devicesNative.view(account.accountId);
    if (!view.serverDeviceId)
      throw new Error("This signed-in session isn't registered with Misty yet.");
    return view;
  }
  if (started?.key === key) return started.promise;
  const promise = (async () =>
    devicesNative.start(account, {
      // Native names the device after the computer ("Matthew's MBP").
      name: "",
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
 * This computer, as its agents' grants name it. It needs no account and no server: an agent works here
 * Connected Devices registers separately, with `ensureDeviceStarted`.
 */
export async function ensureAgentDevice(local: AgentDevice): Promise<{ id: string; name: string }> {
  return { id: local.id, name: local.displayName };
}
