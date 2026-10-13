import { supportsBundledDocumentWorkers } from "@/shared/platform/nativeServices";
import { invoke } from "@tauri-apps/api/core";
import type { DiffSet } from "../components/changes/diffTypes";
import type { AgentDeviceSnapshot, PreparedAgentDocument } from "../model/types";

export async function agentsDeviceSnapshot(): Promise<AgentDeviceSnapshot> {
  return invoke<AgentDeviceSnapshot>("agents_device_snapshot");
}

/** Shares a folder as a project, chosen in the system picker: agents may edit
 * it and run sandboxed commands in it, on this computer only. */
export async function codeChooseProject(): Promise<{ id: string; displayName: string } | null> {
  const result = await invoke<{ id: string; displayName: string } | null>("code_choose_project");
  await republishDeviceFolders();
  return result;
}

/** Stops sharing a project and deletes its undo copies. The folder stays. */
export async function codeRemoveProject(scopeId: string): Promise<void> {
  await invoke("code_remove_project", { scopeId });
  await republishDeviceFolders();
  const { useConversationProject } = await import("./useConversationProject");
  useConversationProject.getState().forget(scopeId);
}

/** Lets agents change a folder that was shared read-only before projects. */
export async function codeAllowProjectChanges(scopeId: string): Promise<void> {
  await invoke("code_allow_project_changes", { scopeId });
}

export async function codeSetProjectInstalls(scopeId: string, allow: boolean): Promise<void> {
  await invoke("code_set_project_installs", { scopeId, allow });
}

export interface CodeCheckpoint {
  runId: string;
  /** Seconds since the epoch. */
  createdAt: number;
  complete: boolean;
  files: number;
}

/** Agent runs in a project whose changes can still be undone, newest first. */
export async function codeCheckpoints(scopeId: string): Promise<CodeCheckpoint[]> {
  const result = await invoke<{ checkpoints: CodeCheckpoint[] }>("code_checkpoints", { scopeId });
  return result.checkpoints;
}

/** Puts a project back the way it was before one agent run. */
export async function codeUndo(
  scopeId: string,
  runId: string,
): Promise<{ restored: number; removed: number }> {
  return invoke("code_undo", { scopeId, runId });
}

/** New project: a named folder where the person picks, as a Git repository. */
export async function codeNewProject(
  name: string,
): Promise<{ id: string; displayName: string } | null> {
  const result = await invoke<{ id: string; displayName: string } | null>("code_new_project", {
    name,
  });
  await republishDeviceFolders();
  return result;
}

/** From GitHub: an empty project folder ready for `cloneInto`. */
export async function codeCloneProject(
  owner: string,
  name: string,
  branch: string,
): Promise<{ id: string; displayName: string } | null> {
  const result = await invoke<{ id: string; displayName: string } | null>("code_clone_project", {
    owner,
    name,
    branch,
  });
  await republishDeviceFolders();
  return result;
}

/** Whether agents may push a project's branches, and its default branch. */
export async function codeSetProjectPush(
  scopeId: string,
  allow: boolean,
  allowDefault: boolean,
): Promise<void> {
  await invoke("code_set_project_push", { scopeId, allow, allowDefault });
}

/** What one answer changed in a project. */
export async function codeRunDiff(scopeId: string, runId: string): Promise<DiffSet> {
  return invoke<DiffSet>("code_run_diff", { scopeId, runId });
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
