import { supportsBundledDocumentWorkers } from "@/shared/platform/nativeServices";
import { invoke } from "@tauri-apps/api/core";
import type { AgentDeviceSnapshot, PreparedAgentDocument } from "../model/interfaces/types";

export async function agentsDeviceSnapshot(): Promise<AgentDeviceSnapshot> {
  return invoke<AgentDeviceSnapshot>("agents_device_snapshot");
}

export async function agentsRevokeFolderScope(scopeId: string): Promise<void> {
  await invoke("agents_revoke_folder_scope", { scopeId });
  await republishDeviceFolders();
}

/** Shares a folder with agents on this device, chosen in the system picker. */
export async function agentsChooseFolderScope(): Promise<unknown> {
  const result = await invoke("agents_choose_folder_scope");
  await republishDeviceFolders();
  return result;
}

/** This device's signed policy lists its shared folders (names only, never
 * paths) so the person's other devices can offer them to agents. */
async function republishDeviceFolders(): Promise<void> {
  const { deviceAccount } = await import("./useAgentDeviceStore");
  const { devicesNative } = await import("@/native/devices");
  await devicesNative.publishFolders(await deviceAccount()).catch(() => {});
}

export async function agentsPrepareScopedDocument(
  request: {
    scopeId: string;
    relativePath: string;
    spaceId: string;
  },
  signal?: AbortSignal,
): Promise<PreparedAgentDocument> {
  if (!supportsBundledDocumentWorkers())
    return invoke("agents_prepare_scoped_document", {
      request: { scopeId: request.scopeId, relativePath: request.relativePath },
    });
  const { withBuiltinService } = await import("@/features/builtin-services");
  return withBuiltinService(
    "files",
    request.spaceId,
    (instance) =>
      invoke<PreparedAgentDocument>("agents_prepare_scoped_document", {
        instance,
        request: { scopeId: request.scopeId, relativePath: request.relativePath },
      }),
    signal,
  );
}
