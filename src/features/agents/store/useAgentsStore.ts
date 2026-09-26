import { supportsBundledDocumentWorkers } from "@/shared/platform/nativeServices";
import { invoke } from "@tauri-apps/api/core";
import type {
  AgentCitation,
  AgentDeviceSnapshot,
  AgentScope,
  PreparedAgentDocument,
} from "../model/interfaces/types";

export async function agentsDeviceSnapshot(): Promise<AgentDeviceSnapshot> {
  return invoke<AgentDeviceSnapshot>("agents_device_snapshot");
}

export async function agentsRegisterFolderScope(request: { path: string }): Promise<AgentScope> {
  return invoke<AgentScope>("agents_register_folder_scope", { request });
}

export async function agentsOpenCitation(request: { citation: AgentCitation }): Promise<void> {
  await invoke("agents_open_citation", { request });
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
