import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Resume, WorkspaceChange, WorkspaceView } from "./model";

export interface SyncDeviceInfo {
  device_id: string;
  display_name: string;
  platform: string;
  control_version: number;
  full_sync: boolean;
  revoked_at?: string | null;
}
export interface NativeSyncView {
  session_id: string;
  deployment: string;
  account_id: string;
  workspace_id: string;
  device_id: string;
  profile_id: string;
  supports_cookie_handoff?: boolean;
  browser_profile_ready?: boolean;
  browser_profile_issue?: string | null;
  status: {
    phase: "connecting" | "offline" | "catching_up" | "ready" | "attention" | "stopped";
    applied_sequence: number;
    head_sequence: number;
    pending_changes: number;
    issue: string | null;
  };
  devices?: SyncDeviceInfo[];
  full_sync?: boolean;
  traffic?: { uploaded_bytes: number; downloaded_bytes: number };
  presence: { device_id: string; online: boolean; ready: boolean; applied_sequence: number }[];
  workspace: WorkspaceView;
  pending_operation_ids: string[];
}
export interface SyncAccount {
  apiBase: string;
  accountId: string;
}
export const readNativeSync = () => invoke<NativeSyncView | null>("browser_sync_state");
export const watchNativeSync = (changed: () => void) =>
  listen("misty:browser-sync-changed", changed);
export const watchNativeProfile = (changed: (sessionId: string) => void) =>
  listen<string>("misty:browser-profile-changed", (event) => changed(event.payload));
export const editNativeWorkspace = (
  sessionId: string,
  operationId: string,
  changes: WorkspaceChange[],
  activeEpoch: string,
) => invoke<string>("browser_sync_edit", { sessionId, operationId, changes, activeEpoch });
export const saveNativeResume = (
  sessionId: string,
  operationId: string,
  resume: Resume,
  activeEpoch: string,
) => invoke<string>("browser_sync_resume", { sessionId, operationId, resume, activeEpoch });
export const activateNativeDevice = (sessionId: string) =>
  invoke<string>("browser_sync_activate", { sessionId });
export const activeDeviceEpoch = (session: NativeSyncView): string | null =>
  session.full_sync !== false && session.workspace.active_device?.device_id === session.device_id
    ? session.workspace.active_device.epoch
    : null;
export const vaultAvailability = (account: SyncAccount) =>
  invoke<{ local: boolean; remote: boolean | null }>("browser_sync_availability", { ...account });
export const generateSyncSecret = () => invoke<string>("browser_sync_generate_secret");
export const unlockNativeSync = (
  account: SyncAccount,
  password: string | null,
  syncSecret: string | null,
  remember: boolean,
  create = false,
) =>
  invoke<NativeSyncView>(create ? "browser_sync_setup" : "browser_sync_connect", {
    ...account,
    password,
    syncSecret,
    remember,
  });
export const lockNativeSync = (sessionId: string, forget = false) =>
  invoke<void>("browser_sync_lock", { sessionId, forget });
export const forgetNativeSyncKey = (account: SyncAccount) =>
  invoke<void>("browser_sync_forget_key", { ...account });

export const controlNativeDevice = (
  sessionId: string,
  deviceId: string,
  fullSync: boolean | null,
  activate = false,
) => invoke<string>("browser_sync_control_device", { sessionId, deviceId, fullSync, activate });
