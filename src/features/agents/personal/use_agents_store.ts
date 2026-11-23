import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import type { AgentDeviceSnapshot, PreparedAgentDocument } from "./agent_scope";
import { useConversationFolder } from "../shared-folders/use_conversation_folder";

export async function agentsDeviceSnapshot(): Promise<AgentDeviceSnapshot> {
  return invoke<AgentDeviceSnapshot>("agents_device_snapshot");
}

export async function thisComputerDeviceId(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  const local = await agentsDeviceSnapshot().catch(() => null);
  return local?.device && local.device.status !== "revoked" ? local.device.id : null;
}

export function allowFolderChanges(key: string, scopeId: string): Promise<boolean> {
  return invoke<boolean>("agents_allow_folder_changes", { key, scopeId });
}

export function stopFolderChanges(key: string, scopeId?: string): Promise<void> {
  return invoke<void>("agents_stop_folder_changes", { key, scopeId: scopeId ?? null });
}

export function adoptFolderChanges(from: string, chat: string): Promise<void> {
  return invoke<void>("agents_adopt_folder_changes", { from, chat });
}

export async function shareFolder(): Promise<{ id: string; displayName: string } | null> {
  return invoke<{ id: string; displayName: string } | null>("agents_share_folder");
}

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
