import { invoke } from "./invoke";

// Devices (docs/design/devices/BRIEF.md). Identity, trust, signatures, the
// control channel and LAN connections stay native; these only drive them.

export interface PeerPresence {
  deviceId: string;
  endpointId: string;
  online: boolean;
  networkKey: string;
  overlay: boolean;
}

export interface ChannelSnapshot {
  connected: boolean;
  admitted: boolean;
  networkKey: string;
  overlay: boolean;
  peers: PeerPresence[];
}

export interface SharedFolder {
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
  endpointId: string | null;
  admitted: boolean;
  canSign: boolean;
  vaultPinned: boolean;
  listVersion: number;
  channel: ChannelSnapshot;
  connected: string[];
  policy: DevicePolicy | null;
}

export interface AdmissionView {
  requestId: string;
  state: "pending" | "challenged" | "revealed" | "approved" | "denied" | "expired";
  code: string | null;
  deviceName: string;
  admitted: boolean;
}

export interface PendingAdmission {
  requestId: string;
  deviceId: string;
  deviceName: string;
  state: AdmissionView["state"];
}

export interface SignedRecord {
  payload: string;
  signature: string;
}

export interface DeliveryReceipt {
  destinationDeviceId: string;
  fileName: string;
  size: number;
  sha256: string;
}

type Account = { apiBase: string; accountId: string };

export const devicesNative = {
  start: (
    account: Account,
    device: { name: string; platform: string; osVersion: string; appVersion: string },
  ) => invoke<DevicesView>("devices_start", { ...account, ...device }),
  stop: () => invoke<void>("devices_stop"),
  view: (accountId: string) => invoke<DevicesView>("devices_view", { accountId }),
  refresh: (account: Account) => invoke<DevicesView>("devices_refresh", account),
  admitSelf: (account: Account) => invoke<DevicesView>("devices_admit_self", account),
  requestApproval: (account: Account) => invoke<AdmissionView>("devices_request_approval", account),
  approvalStatus: (account: Account, requestId: string) =>
    invoke<AdmissionView>("devices_approval_status", { ...account, requestId }),
  pendingRequests: (account: Account) =>
    invoke<PendingAdmission[]>("devices_pending_requests", account),
  approveStart: (account: Account, requestId: string) =>
    invoke<AdmissionView>("devices_approve_start", { ...account, requestId }),
  approveStatus: (account: Account, requestId: string) =>
    invoke<AdmissionView>("devices_approve_status", { ...account, requestId }),
  approveConfirm: (account: Account, requestId: string) =>
    invoke<void>("devices_approve_confirm", { ...account, requestId }),
  deny: (account: Account, requestId: string) =>
    invoke<void>("devices_deny", { ...account, requestId }),
  remove: (account: Account, deviceId: string) =>
    invoke<DevicesView>("devices_remove", { ...account, deviceId }),
  rename: (account: Account, deviceId: string, name: string) =>
    invoke<void>("devices_rename", { ...account, deviceId, name }),
  setPolicy: (
    account: Account,
    policy: { files: FileSharing; clipboard: boolean; agentSurfaces: AgentSurface[] },
  ) => invoke<DevicePolicy>("devices_set_policy", { ...account, ...policy }),
  publishFolders: (account: Account) => invoke<void>("devices_publish_folders", account),
  connect: (deviceId: string) => invoke<boolean>("devices_connect", { deviceId }),
  signRequest: (
    account: Account,
    request: { method: string; path: string; timestamp: string; nonce: string; bodyDigest: string },
  ) => invoke<string>("device_sign_request", { ...account, ...request }),
  signRunGrants: (
    account: Account,
    grants: {
      targetDeviceId: string;
      agentId?: string;
      capabilities: string[];
      scopes: string[];
    }[],
  ) => invoke<SignedRecord[]>("device_sign_run_grants", { ...account, grants }),
  verifyJob: (operation: string, scopeId: string, config: unknown) =>
    invoke<void>("device_verify_job", { operation, scopeId, config }),
  sendFile: (scopeId: string, input: unknown, config: unknown) =>
    invoke<DeliveryReceipt>("device_send_file", { scopeId, input, config }),
};
