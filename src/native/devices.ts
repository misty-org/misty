import { invoke } from "./invoke";

// This signed-in session's identity. Its key, signatures and the channel stay native; these
// only drive them.

interface PeerPresence {
  deviceId: string;
  online: boolean;
}

interface ChannelSnapshot {
  connected: boolean;
  admitted: boolean;
  peers: PeerPresence[];
}

interface SharedFolder {
  scopeId: string;
  name: string;
}

export type FileSharing = "off" | "view" | "edit";
export type AgentSurface = "folders" | "browser" | "terminal";

export interface DevicePolicy {
  version: number;
  files: FileSharing;
  clipboard: boolean;
  agentSurfaces: AgentSurface[];
  sharedFolders: SharedFolder[];
}

export interface DevicesView {
  serverDeviceId: string | null;
  admitted: boolean;
  channel: ChannelSnapshot;
  policy: DevicePolicy | null;
}

interface SignedRecord {
  payload: string;
  signature: string;
}

type Account = { apiBase: string; accountId: string };

export const devicesNative = {
  start: (
    account: Account,
    device: { name: string; platform: string; osVersion: string; appVersion: string },
  ) => invoke<DevicesView>("devices_start", { ...account, ...device }),
  stop: () => invoke<void>("devices_stop"),
  view: (_accountId: string) => invoke<DevicesView>("devices_view"),
  publishFolders: (account: Account) => invoke<void>("devices_publish_folders", account),
  signRequest: (
    account: Account,
    request: { method: string; path: string; timestamp: string; nonce: string; bodyDigest: string },
  ) => invoke<string>("device_sign_request", { ...account, ...request }),
  /** Grants from this computer to itself. They need no account. */
  signRunGrants: (
    grants: {
      agentId?: string;
      chatKey?: string;
      capabilities: string[];
      scopes: string[];
    }[],
  ) => invoke<SignedRecord[]>("device_sign_run_grants", { grants }),
  verifyJob: (operation: string, scopeId: string, config: unknown) =>
    invoke<void>("device_verify_job", { operation, scopeId, config }),
  /** A shared folder's file for a `folder.send` job, checked against the job's
   * run grant natively. Arrives as raw bytes (at most 128 MiB). */
  readSharedFile: (scopeId: string, input: unknown, config: unknown) =>
    invoke<ArrayBuffer>("device_read_shared_file", { scopeId, input, config }),
};
