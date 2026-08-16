import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { resolveRequiredApiBase } from "@/api/client";
import type { AiArtifact, AiSurfaceAdapter } from "@/features/ai-surface/types";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import { useMistyStore } from "./useMistyStore";
import { openMisty } from "./handoff";

export interface FolderSnapshot {
  grantId: string;
  folderName: string;
  items: Array<{
    id: string;
    name: string;
    relativePath: string;
    directory: boolean;
    size: number;
  }>;
  excluded: string[];
}
export interface FileManifest {
  id: string;
  grantId: string;
  state: string;
  receipts: Array<{ index: number; from?: string; to: string; state: string; error?: string }>;
}
type Step =
  | { action: "move"; source_id: string; destination: string }
  | { action: "mkdir"; destination: string };
export const useFolderOrganization = create<{
  accountId: string;
  snapshot?: FolderSnapshot;
  manifest?: FileManifest;
  applying: boolean;
  error?: string;
}>(() => ({ accountId: "", applying: false }));
let unregister: (() => void) | undefined;

export function organizationSteps(artifact: AiArtifact, snapshot: FolderSnapshot): Step[] {
  if (artifact.kind !== "file_plan") throw new Error("This is not a file organization proposal.");
  const steps = (artifact.operations as { steps?: Array<Record<string, unknown>> }).steps;
  if (!steps?.length || steps.length > 100)
    throw new Error("A proposal must contain 1–100 changes.");
  return steps.map((step) => {
    if (step.conflict_policy !== "ask" || step.destination_scope_id !== snapshot.grantId)
      throw new Error(
        "The proposal must stay inside the selected folder and never overwrite files.",
      );
    const destination = typeof step.display_name === "string" ? step.display_name : "";
    if (!destination || destination.split(/[\\/]/).some((name) => !name || name.startsWith(".")))
      throw new Error("The proposal contains an invalid relative destination.");
    if (step.action === "mkdir") return { action: "mkdir", destination };
    if (step.action !== "move" && step.action !== "rename")
      throw new Error("Organization permits only folder creation, moves and renames.");
    const source = snapshot.items.find(
      (item) => item.id === step.source_scope_id && !item.directory,
    );
    if (!source) throw new Error("The proposal references a file outside the selected folder.");
    return { action: "move", source_id: source.id, destination };
  });
}
async function credentials(accountId: string) {
  const apiBase = await resolveRequiredApiBase();
  if (useMistyStore.getState().accountId !== accountId)
    throw new Error("The Misty account changed.");
  return { accountId, apiBase };
}
function publishManifest(accountId: string, manifest: FileManifest) {
  if (useMistyStore.getState().accountId === accountId)
    useFolderOrganization.setState({ accountId, manifest });
}
function registerOrganization(accountId: string, snapshot: FolderSnapshot) {
  const paneId = `organization-${snapshot.grantId}`;
  const adapter: AiSurfaceAdapter = {
    surfaceId: "files",
    label: snapshot.folderName,
    getContext: () => [
      {
        kind: "files.scope",
        id: snapshot.grantId,
        title: snapshot.folderName,
        privacy: "device",
        opaqueScopeId: snapshot.grantId,
      },
    ],
    getSelection: () => ({
      kind: "objects",
      contentHash: snapshot.grantId,
      content: JSON.stringify({
        folder_scope_id: snapshot.grantId,
        folder_name: snapshot.folderName,
        items: snapshot.items.map(({ id, relativePath, directory, size }) => ({
          id,
          relative_path: relativePath,
          directory,
          size,
        })),
        excluded: snapshot.excluded,
        instructions:
          "Metadata only. Propose mkdir, move or rename steps. " +
          "Every destination_scope_id must be folder_scope_id. " +
          "display_name is the relative destination including parent folders. " +
          "source_scope_id is an exact regular-file item ID; for mkdir use folder_scope_id. " +
          "conflict_policy must be ask. List mkdir before moves into new folders. " +
          "No deletion, shell, absolute paths, hidden items, directory moves or overwrites. " +
          "Leave ambiguous files unchanged and explain them.",
      }),
      object: { kind: "files.scope", id: snapshot.grantId },
    }),
    canApply: (artifact) => {
      try {
        organizationSteps(artifact, snapshot);
        return (
          useMistyStore.getState().accountId === accountId &&
          useFolderOrganization.getState().snapshot?.grantId === snapshot.grantId
        );
      } catch {
        return false;
      }
    },
    applyArtifact: async (artifact) => {
      const auth = await credentials(accountId);
      const planId = artifact.id.replace(/^artifact_/, "");
      const prepared = await invoke<FileManifest>("agent_files_prepare", {
        ...auth,
        grantId: snapshot.grantId,
        planId,
        steps: organizationSteps(artifact, snapshot),
      });
      publishManifest(accountId, prepared);
      useFolderOrganization.setState({ applying: true, error: undefined });
      try {
        const manifest = await invoke<FileManifest>("agent_files_apply", { ...auth, planId });
        publishManifest(accountId, manifest);
        if (manifest.state !== "completed")
          throw new Error(
            "Some changes were not completed. Review the operation receipt before continuing.",
          );
      } finally {
        useFolderOrganization.setState({ applying: false });
      }
    },
    undoArtifact: async (artifact) => {
      const manifest = await invoke<FileManifest>("agent_files_undo", {
        ...(await credentials(accountId)),
        planId: artifact.id.replace(/^artifact_/, ""),
      });
      publishManifest(accountId, manifest);
      if (manifest.state !== "undone")
        throw new Error("Undo stopped because files changed. Review the operation receipt.");
    },
  };
  unregister?.();
  useFolderOrganization.setState({ accountId, snapshot, error: undefined });
  unregister = useAiSurfaceStore
    .getState()
    .registerPane({ accountId, paneId, adapter, element: document.body });
  return { paneId, adapter };
}
let restoring: { key: string; promise: Promise<string> } | undefined;
export function restoreOrganizationProposal(
  accountId: string,
  artifact: AiArtifact,
): Promise<string> {
  const grantId = artifact.target?.kind === "files.scope" ? artifact.target.id : undefined;
  if (!grantId)
    return Promise.reject(
      new Error(
        "This proposal has no selected folder. Choose a folder and request a new proposal.",
      ),
    );
  const key = `${accountId}:${grantId}`;
  if (restoring?.key === key) return restoring.promise;
  const promise = (async () => {
    const snapshot = await invoke<FolderSnapshot>("agent_files_snapshot", {
      ...(await credentials(accountId)),
      grantId,
    });
    await credentials(accountId);
    const { paneId } = registerOrganization(accountId, snapshot);
    if (useMistyStore.getState().pendingArtifact?.id === artifact.id)
      useMistyStore.setState({ artifactPaneId: paneId });
    return paneId;
  })();
  restoring = { key, promise };
  void promise
    .finally(() => {
      if (restoring?.promise === promise) restoring = undefined;
    })
    .catch(() => {});
  return promise;
}
export async function chooseOrganizationFolder(accountId: string) {
  if (useMistyStore.getState().working || useFolderOrganization.getState().applying)
    throw new Error("Wait for the active task or stop it before choosing another folder.");
  if (useMistyStore.getState().query.trim())
    throw new Error("Send or clear your draft before starting folder organization.");
  const snapshot = await invoke<FolderSnapshot | null>(
    "agent_files_choose",
    await credentials(accountId),
  );
  if (!snapshot) return;
  await credentials(accountId);
  const previous = useFolderOrganization.getState();
  if (previous.accountId === accountId && previous.snapshot)
    await invoke("agent_files_revoke", {
      ...(await credentials(accountId)),
      grantId: previous.snapshot.grantId,
    });
  const { paneId, adapter } = registerOrganization(accountId, snapshot);
  await openMisty({
    accountId,
    paneId,
    surfaceId: "files",
    context: adapter
      .getContext()
      .map((ref) => ({ ...ref, source: "current" as const, attached: true })),
    selection: adapter.getSelection!()!,
    requestedArtifactKind: "file_plan",
    prompt: `Propose a clear organization for ${snapshot.folderName}. Show the moves and any unresolved items for my review. Do not apply changes yet.`,
  });
}
export async function stopFolderOrganization(accountId: string) {
  const { manifest } = useFolderOrganization.getState();
  if (manifest)
    await invoke("agent_files_cancel", { ...(await credentials(accountId)), planId: manifest.id });
}
export async function undoFolderOrganization(accountId: string) {
  const { manifest } = useFolderOrganization.getState();
  if (!manifest) return;
  const result = await invoke<FileManifest>("agent_files_undo", {
    ...(await credentials(accountId)),
    planId: manifest.id,
  });
  publishManifest(accountId, result);
}
export async function releaseOrganizationFolder(accountId: string) {
  const { snapshot } = useFolderOrganization.getState();
  if (snapshot)
    await invoke("agent_files_revoke", {
      ...(await credentials(accountId)),
      grantId: snapshot.grantId,
    });
  unregister?.();
  unregister = undefined;
  useFolderOrganization.setState({ snapshot: undefined });
}

export async function loadFolderHistory(accountId: string) {
  const history = await invoke<FileManifest[]>("agent_files_history", await credentials(accountId));
  if (useMistyStore.getState().accountId !== accountId) return;
  if (!useFolderOrganization.getState().applying && !useFolderOrganization.getState().snapshot)
    useFolderOrganization.setState({ accountId, manifest: history[0] });
}
export async function resumeFolderOrganization(accountId: string) {
  const { manifest } = useFolderOrganization.getState();
  if (!manifest) return;
  useFolderOrganization.setState({ applying: true });
  try {
    publishManifest(
      accountId,
      await invoke<FileManifest>("agent_files_apply", {
        ...(await credentials(accountId)),
        planId: manifest.id,
      }),
    );
  } finally {
    useFolderOrganization.setState({ applying: false });
  }
}
