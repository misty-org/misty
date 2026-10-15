import { invoke } from "@tauri-apps/api/core";
import type { DiffSet } from "../components/changes/diffTypes";
import type { AgentDeviceSnapshot, PreparedAgentDocument } from "../model/types";

export async function agentsDeviceSnapshot(): Promise<AgentDeviceSnapshot> {
  return invoke<AgentDeviceSnapshot>("agents_device_snapshot");
}

/** Shares a folder as a project, chosen in the system picker. Coding there
 * runs in the person's own coding tool, on this computer only. */
export async function chooseProject(): Promise<{ id: string; displayName: string } | null> {
  const result = await invoke<{ id: string; displayName: string } | null>("project_choose");
  await republishDeviceFolders();
  return result;
}

/** Stops sharing a project. The folder and its files stay. */
export async function removeProject(scopeId: string): Promise<void> {
  await invoke("project_remove", { scopeId });
  await republishDeviceFolders();
  const { useConversationProject } = await import("./useConversationProject");
  useConversationProject.getState().forget(scopeId);
}

/** New project: a named folder where the person picks, as a Git repository. */
export async function newProject(
  name: string,
): Promise<{ id: string; displayName: string } | null> {
  const result = await invoke<{ id: string; displayName: string } | null>("project_new", { name });
  await republishDeviceFolders();
  return result;
}

/** What changed in a project since its last commit, from git. */
export async function projectGitDiff(scopeId: string): Promise<DiffSet> {
  return invoke<DiffSet>("project_git_diff", { scopeId });
}

/** What one delegated coding run changed in its project. */
export async function projectRunDiff(scopeId: string, runId: string): Promise<DiffSet> {
  return invoke<DiffSet>("project_run_diff", { scopeId, runId });
}

/** The result of undoing a run: files put back and removed, and commits. */
export interface UndoResult {
  restored: number;
  removed: number;
  commitsRemoved: number;
  commitsPushed: number;
}

/** Puts the project back the way it was before a delegated coding run. */
export async function projectUndo(scopeId: string, runId: string): Promise<UndoResult> {
  return invoke<UndoResult>("project_undo", { scopeId, runId });
}

/** The runs in a project that can still be undone, newest first. */
export async function projectCheckpoints(
  scopeId: string,
): Promise<Array<{ runId: string; createdAt: number; complete: boolean }>> {
  const result = await invoke<{
    checkpoints: Array<{ runId: string; createdAt: number; complete: boolean }>;
  }>("project_checkpoints", { scopeId });
  return result.checkpoints;
}

/** This device's signed policy lists its shared folders (names only, never
 * paths) so the person's other devices can offer them to agents. */
export async function republishDeviceFolders(): Promise<void> {
  const { deviceAccount } = await import("./useAgentDeviceStore");
  const { devicesNative } = await import("@/native/devices");
  await devicesNative.publishFolders(await deviceAccount()).catch(() => {});
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
