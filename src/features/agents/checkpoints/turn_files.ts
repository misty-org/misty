import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { GlobalAiMessage } from "../conversations/state/conversation_types";

export interface TurnFileChange {
  path: string;
  change: "restore" | "remove";
  changedByYou: boolean;
}

export interface RewindFiles {
  folders: { folder: string; files: TurnFileChange[] }[];
  incomplete: boolean;
}

export interface ChosenFile {
  folder: string;
  path: string;
}

export function removedRunIds(messages: readonly GlobalAiMessage[], fromIndex: number): string[] {
  if (fromIndex < 0) return [];
  const ids = messages
    .slice(fromIndex)
    .flatMap((message) =>
      message.role === "assistant" && message.invocationId ? [message.invocationId] : [],
    );
  return [...new Set(ids)];
}

export function planFiles(plan: RewindFiles): (TurnFileChange & { folder: string })[] {
  return plan.folders.flatMap(({ folder, files }) => files.map((file) => ({ ...file, folder })));
}

export function chosenByDefault(plan: RewindFiles): ChosenFile[] {
  return planFiles(plan)
    .filter((file) => !file.changedByYou)
    .map(({ folder, path }) => ({ folder, path }));
}

export const fileKey = (file: ChosenFile) => `${file.folder}\n${file.path}`;

export async function rewindFiles(runIds: string[]): Promise<RewindFiles | null> {
  if (!runIds.length || !hasTauriInternals()) return null;
  return invoke<RewindFiles>("agent_turn_files", { runIds }).catch(() => null);
}

export async function restoreTurnFiles(
  runIds: string[],
  files: ChosenFile[],
): Promise<{ restored: number; failed: string[] }> {
  if (!files.length) return { restored: 0, failed: [] };
  return invoke("agent_turn_restore", { runIds, files });
}
