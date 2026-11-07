import { invoke } from "@tauri-apps/api/core";
import type { AgentDeviceSnapshot, PreparedAgentDocument } from "../model/types";

export async function agentsDeviceSnapshot(): Promise<AgentDeviceSnapshot> {
  return invoke<AgentDeviceSnapshot>("agents_device_snapshot");
}

/** Shares a folder with agents, read-only, chosen in the system picker. */
/** The native question behind "Allow changes", for a chat, the new chat ("draft") or `workflow:<id>`. */
export function allowFolderChanges(key: string, scopeId: string): Promise<boolean> {
  return invoke<boolean>("agents_allow_folder_changes", { key, scopeId });
}

/** Takes "Allow changes" back, from the next command on. */
export function stopFolderChanges(key: string, scopeId?: string): Promise<void> {
  return invoke<void>("agents_stop_folder_changes", { key, scopeId: scopeId ?? null });
}

/** A new chat takes on its draft's answer, or a scheduled run its workflow's. */
export function adoptFolderChanges(from: string, chat: string): Promise<void> {
  return invoke<void>("agents_adopt_folder_changes", { from, chat });
}

export async function shareFolder(): Promise<{ id: string; displayName: string } | null> {
  const result = await invoke<{ id: string; displayName: string } | null>("agents_share_folder");
  await republishDeviceFolders();
  return result;
}

/** Stops sharing a folder. The folder and its files stay. */
export async function forgetFolder(scopeId: string): Promise<void> {
  await invoke("agents_forget_folder", { scopeId });
  await republishDeviceFolders();
  const { useConversationFolder } = await import("./useConversationFolder");
  useConversationFolder.getState().forget(scopeId);
}

/** This device's signed policy lists its shared folders (names only, never
 * paths) so the person's other devices can offer them to agents. */
export async function republishDeviceFolders(): Promise<void> {
  const { deviceAccount } = await import("./useAgentDeviceStore");
  const { devicesNative } = await import("@/native/devices");
  // Signed out or offline there's nobody to tell, and the folder is shared here all the same.
  await deviceAccount()
    .then((account) => devicesNative.publishFolders(account))
    .catch(() => {});
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
