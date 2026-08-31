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

export async function agentsPrepareDocument(request: {
  path: string;
}): Promise<PreparedAgentDocument> {
  return invoke<PreparedAgentDocument>("agents_prepare_document", { request });
}

export async function agentsPrepareScopedDocument(request: {
  scopeId: string;
  relativePath: string;
}): Promise<PreparedAgentDocument> {
  return invoke<PreparedAgentDocument>("agents_prepare_scoped_document", { request });
}
