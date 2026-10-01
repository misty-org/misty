import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeviceWebsiteData } from "./websiteData";
import type { Resume, SharedRecord, WorkspaceChange, WorkspaceRecords } from "./model";

export interface SyncDeviceInfo {
  device_id: string;
  display_name: string;
  platform: string;
  os_version?: string;
  created_at?: string | null;
  control_version: number;
  full_sync: boolean;
  revoked_at?: string | null;
}
/** One workspace: a device sign-in's windows and tabs, and which machine
 * holds its sign-in lease. */
export interface SyncWorkspace {
  workspace_id: string;
  shared: boolean;
  driver_device_id: string | null;
  driver_epoch: string | null;
  driver_seen_at: number | null;
  version: number;
}
export interface SyncState {
  device_id: string;
  shared_workspace_id: string;
  /** The workspace whose sign-in lease this device holds (it publishes that
   * workspace's sign-ins). Not a lock: editing follows `on_workspace`. */
  driving_workspace: string | null;
  /** The workspace this machine shows and edits. Any number of machines may
   * be on one workspace at once. */
  on_workspace?: string | null;
  workspaces: SyncWorkspace[];
  /** Verified content of each workspace this machine keeps current. */
  contents: Record<
    string,
    { version: number; records: SharedRecord[]; resume: Resume | null; author: string | null }
  >;
  pending: string[];
  displaced_with_edits: boolean;
  /** The server confirmed `driving_workspace` on the current connection. */
  seat_confirmed?: boolean;
  /** The workspace kept current while this device drives none (the one it drove last). */
  following?: string | null;
  /** This machine has a copy of `on_workspace` to edit. */
  writable?: boolean;
  /** Collections as shown, by name (bookmarks, saved tab groups). */
  collections?: Record<string, SharedRecord[]>;
  /** Every device runs a version that syncs tab groups; until then they stay local. */
  all_upgraded?: boolean;
}
export interface NativeSyncView {
  session_id: string;
  deployment: string;
  account_id: string;
  vault_id: string;
  device_id: string;
  profile_id: string;
  supports_cookie_handoff?: boolean;
  browser_profile_ready?: boolean;
  browser_profile_issue?: string | null;
  /** Per device: what each site's cookies and storage contributed to its sync. */
  website_data?: DeviceWebsiteData[];
  status: {
    phase: "connecting" | "offline" | "catching_up" | "ready" | "attention" | "stopped";
    applied_sequence: number;
    head_sequence: number;
    pending_changes: number;
    issue: string | null;
  };
  devices?: SyncDeviceInfo[];
  full_sync?: boolean;
  traffic?: {
    uploaded_bytes: number;
    downloaded_bytes: number;
    /** Workspace publication counters, for tracing unchanged resends. */
    workspace_edit_batches?: number;
    workspace_records_unchanged?: number;
    workspace_records_written?: number;
    workspace_ops_suppressed?: number;
    workspace_ops_built?: number;
  };
  presence: { device_id: string; online: boolean; ready: boolean; applied_sequence: number }[];
  workspace: WorkspaceRecords;
  pending_operation_ids: string[];
  /** Workspaces and this machine's standing in them; absent before this
   * vault switched to workspaces. */
  sync?: SyncState | null;
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
export const activateNativeDevice = (sessionId: string) =>
  invoke<string>("browser_sync_activate", { sessionId });
export const renameNativeDevice = (sessionId: string, deviceId: string, name: string) =>
  invoke<void>("browser_sync_rename_device", { sessionId, deviceId, name });
/** Open `workspaceId` on this machine. Other machines keep editing it too. */
export const claimNativeWorkspace = (sessionId: string, workspaceId: string) =>
  invoke<void>("browser_sync_claim", { sessionId, workspaceId });
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
  /** Register this device again after the server rejected its identity. */
  reenroll = false,
) =>
  invoke<NativeSyncView>(
    create ? "browser_sync_setup" : "browser_sync_connect",
    create
      ? { ...account, password, syncSecret, remember }
      : { ...account, password, syncSecret, remember, reenroll },
  );
export const lockNativeSync = (sessionId: string, forget = false) =>
  invoke<void>("browser_sync_lock", { sessionId, forget });
export const forgetNativeSyncKey = (account: SyncAccount) =>
  invoke<void>("browser_sync_forget_key", { ...account });

export const controlNativeDevice = (
  sessionId: string,
  deviceId: string,
  fullSync: boolean | null,
  activate = false,
  workspaceId: string | null = null,
) =>
  invoke<string>("browser_sync_control_device", {
    sessionId,
    deviceId,
    fullSync,
    activate,
    workspaceId,
  });
