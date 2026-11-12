import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { GlobalAiMessage } from "../conversations/state/conversationTypes";

/**
 * The files a rewind would put back. Native code saves the folder each turn works in before it
 * starts and as it ends (src-tauri/features/agents/run_control/turn_rewind.rs), so a rewind can
 * return the agent's files to how they were before the first removed turn.
 */
export interface TurnFileChange {
  path: string;
  /** `restore` writes the file back as it was; `remove` takes away one the turns made. */
  change: "restore" | "remove";
  /** The person changed it too (or nobody can tell), so it is only put back if they say so. */
  changedByYou: boolean;
}

export interface RewindFiles {
  folders: { folder: string; files: TurnFileChange[] }[];
  /** Some removed turn's files weren't saved, so they stay as they are. */
  incomplete: boolean;
}

/** A file the person agreed to put back. */
export interface ChosenFile {
  folder: string;
  path: string;
}

/** The runs of the turns a rewind to `fromIndex` removes, oldest first. */
export function removedRunIds(messages: readonly GlobalAiMessage[], fromIndex: number): string[] {
  if (fromIndex < 0) return [];
  const ids = messages
    .slice(fromIndex)
    .flatMap((message) =>
      message.role === "assistant" && message.invocationId ? [message.invocationId] : [],
    );
  return [...new Set(ids)];
}

/** Every file of the plan, folder by folder. */
export function planFiles(plan: RewindFiles): (TurnFileChange & { folder: string })[] {
  return plan.folders.flatMap(({ folder, files }) => files.map((file) => ({ ...file, folder })));
}

/** What is chosen before the person looks: the agent's own files, not the ones they changed. */
export function chosenByDefault(plan: RewindFiles): ChosenFile[] {
  return planFiles(plan)
    .filter((file) => !file.changedByYou)
    .map(({ folder, path }) => ({ folder, path }));
}

export const fileKey = (file: ChosenFile) => `${file.folder}\n${file.path}`;

/** What rewinding past these runs would put back; nothing outside the desktop app. */
export async function rewindFiles(runIds: string[]): Promise<RewindFiles | null> {
  if (!runIds.length || !hasTauriInternals()) return null;
  return invoke<RewindFiles>("agent_turn_files", { runIds }).catch(() => null);
}

/** Puts back the chosen files. Native code checks each against the plan it works out again. */
export async function restoreTurnFiles(
  runIds: string[],
  files: ChosenFile[],
): Promise<{ restored: number; failed: string[] }> {
  if (!files.length) return { restored: 0, failed: [] };
  return invoke("agent_turn_restore", { runIds, files });
}
