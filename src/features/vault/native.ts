import { invoke } from "@tauri-apps/api/core";
import { resolveApiBase } from "@/api/deployment/api";

export type VaultNotice = "storage_full" | "session_removed" | "vault_gone";

export interface LinkStatus {
  connected: boolean;
  sending: number;
  receiving: number;
  set_aside: number;
  synced_at: number | null;
  notice: VaultNotice | null;
  stopped: boolean;
}

export type VaultState =
  | { state: "off"; exists: boolean | null; asked: boolean; notice: VaultNotice | null }
  | { state: "paused"; vault_id: string }
  | { state: "on"; vault_id: string; session_id: string; status: LinkStatus };

export interface UsagePart {
  name: string;
  bytes: number;
}

export interface VaultUsage {
  bytes: number;
  limitBytes: number | null;
  byProfile: UsagePart[];
  byKind: UsagePart[];
  sentBytes: number;
  receivedBytes: number;
  setAside: UsagePart[];
  siteSkips?: { site: string; kind: "cookies" | "local_storage"; reason: string }[];
  cookieChecks?: {
    profile: string;
    check: { beganAt: number; readAt: number; cookies: number; sites: number } | null;
  }[];
}

export interface VaultSession {
  session_id: string;
  name: string;
  platform: string;
  os_version: string;
  created_at: string;
  last_seen_at?: string | null;
  revoked_at?: string | null;
}

type DestroyProof = { vaultPassword: string } | { accountPassword: string };

const withServer = async <T>(command: string, args: Record<string, unknown> = {}) =>
  invoke<T>(command, { apiBase: await resolveApiBase(), ...args });

export const vaultNative = {
  state: () => withServer<VaultState>("vault_state"),
  resume: () => withServer<void>("vault_resume"),
  create: (password: string) => withServer<void>("vault_create", { password }),
  unlock: (password: string) => withServer<void>("vault_unlock", { password }),
  pause: () => invoke<void>("vault_pause"),
  start: () => withServer<void>("vault_start"),
  decline: () => invoke<void>("vault_decline"),
  changePassword: (password: string) => withServer<void>("vault_change_password", { password }),
  destroy: (proof: DestroyProof) => withServer<void>("vault_destroy", { proof }),
  sessions: () => withServer<VaultSession[]>("vault_sessions"),
  renameSession: (sessionId: string, name: string) =>
    withServer<void>("vault_rename_session", { sessionId, name }),
  removeSession: (sessionId: string) => withServer<void>("vault_remove_session", { sessionId }),
  usage: () => withServer<VaultUsage>("vault_usage"),
};
