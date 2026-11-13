import { invoke } from "@tauri-apps/api/core";
import type { AgentDeviceSnapshot, PreparedAgentDocument } from "./agentScope";
import { useConversationFolder } from "../shared-folders/useConversationFolder";

export async function agentsDeviceSnapshot(): Promise<AgentDeviceSnapshot> {
  return invoke<AgentDeviceSnapshot>("agents_device_snapshot");
}

/** This computer's id for its agents, or null outside the desktop app. */
export async function thisComputerDeviceId(): Promise<string | null> {
  const { hasTauriInternals } = await import("@/shared/platform/tauri");
  if (!hasTauriInternals()) return null;
  const local = await agentsDeviceSnapshot().catch(() => null);
  return local?.device && local.device.status !== "revoked" ? local.device.id : null;
}

/** Shares a folder with agents, read-only, chosen in the system picker. */
/** The native question behind "Allow changes", for a chat or the new chat ("draft"). */
export function allowFolderChanges(key: string, scopeId: string): Promise<boolean> {
  return invoke<boolean>("agents_allow_folder_changes", { key, scopeId });
}

/** Takes "Allow changes" back, from the next command on. */
export function stopFolderChanges(key: string, scopeId?: string): Promise<void> {
  return invoke<void>("agents_stop_folder_changes", { key, scopeId: scopeId ?? null });
}

/** A new chat takes on its draft's answer. */
export function adoptFolderChanges(from: string, chat: string): Promise<void> {
  return invoke<void>("agents_adopt_folder_changes", { from, chat });
}

export async function shareFolder(): Promise<{ id: string; displayName: string } | null> {
  return invoke<{ id: string; displayName: string } | null>("agents_share_folder");
}

/** Stops sharing a folder. The folder and its files stay. */
export async function forgetFolder(scopeId: string): Promise<void> {
  await invoke("agents_forget_folder", { scopeId });
  useConversationFolder.getState().forget(scopeId);
}

export async function agentsPrepareScopedDocument(
  request: { scopeId: string; relativePath: string },
  signal?: AbortSignal,
): Promise<PreparedAgentDocument> {
  signal?.throwIfAborted();
  return invoke<PreparedAgentDocument>("agents_prepare_scoped_document", {
    request: { scopeId: request.scopeId, relativePath: request.relativePath },
  });
}
