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
interface SyncWorkspace {
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
  /** Every device understands nested bookmark folders; until then folders stay flat. */
  nested_bookmarks?: boolean;
  /** Every device understands pinned tabs; until then pins can't be kept through sync. */
  pinned_tabs?: boolean;
  /** Records with changes the server has not confirmed yet, one per record. */
  unsynced?: UnsyncedRecord[];
  /** Edits an older version set aside unsent: kept on this device, never synced. */
  retired_edits?: number;
}
export interface UnsyncedRecord {
  workspace_id: string;
  kind: string;
  id: string;
  /** The newest waiting change removes it (a closed tab). */
  deleted: boolean;
  title: string | null;
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
    /** Ticks that held a queue back until its batch was due. */
    workspace_ops_deferred?: number;
    /** Queued edits that never reached the server (folded or cancelled out). */
    workspace_edits_coalesced?: number;
  };
  presence: { device_id: string; online: boolean; ready: boolean; applied_sequence: number }[];
  workspace: WorkspaceRecords;
  pending_operation_ids: string[];
  /** Workspaces and this machine's standing in them; absent before this
   * vault switched to workspaces. */
  sync?: SyncState | null;
  /** Spaces whose own vault has a problem. Sync shows one state for the
   * account and names a Space only when it is the one in trouble. */
  space_problems?: { space_id: string; issue: string }[];
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
/** Sync now: send batched changes without waiting for their batch. */
export const flushNativeSync = (sessionId: string) =>
  invoke<void>("browser_sync_flush", { sessionId });
export const activeDeviceEpoch = (session: NativeSyncView): string | null =>
  session.full_sync !== false && session.workspace.active_device?.device_id === session.device_id
    ? session.workspace.active_device.epoch
    : null;
export const vaultAvailability = (account: SyncAccount) =>
  invoke<{ local: boolean; remote: boolean | null; accountPassword: boolean | null }>(
    "browser_sync_availability",
    { ...account },
  );
/**
 * A vault is sealed under the Misty password (`email` and `password`). One made
 * before that also needs its sync secret until it is moved over.
 */
export const unlockNativeSync = (
  account: SyncAccount,
  email: string | null,
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
      ? { ...account, email, password, remember }
      : { ...account, email, password, syncSecret, remember, reenroll },
  );
/** Re-seals the open vault under a Misty password the server has never seen in plain form. */
export const resealSyncWithAccountPassword = (account: SyncAccount, email: string, password: string) =>
  invoke<void>("browser_sync_use_account_password", { ...account, email, password });
export const lockNativeSync = (sessionId: string, forget = false) =>
  invoke<void>("browser_sync_lock", { sessionId, forget });
export const forgetNativeSyncKey = (account: SyncAccount) =>
  invoke<void>("browser_sync_forget_key", { ...account });
/** Deletes the account's only vault, everywhere, so a new one can be created. */
export const deleteNativeSyncVault = (account: SyncAccount, currentPassword: string | null) =>
  invoke<void>("browser_sync_delete_vault", { ...account, currentPassword });

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
