import { create } from "zustand";

/**
 * The shared folder a scheduled workflow may use on this computer, by workflow. Nobody's watching a
 * scheduled run, so it gets neither a folder nor write access unless the person turned them on for
 * that workflow. Grants belong to the device, so this never syncs.
 */
const storageKey = "misty.scheduleFolders.v1";

export interface ScheduleFolder {
  folderId: string;
  writable: boolean;
}

function load(): Record<string, ScheduleFolder> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, Partial<ScheduleFolder>>).flatMap(([id, entry]) =>
        typeof entry?.folderId === "string"
          ? [[id, { folderId: entry.folderId, writable: entry.writable === true }]]
          : [],
      ),
    );
  } catch {
    return {};
  }
}

interface ScheduleFoldersState {
  byWorkflow: Record<string, ScheduleFolder>;
  set(workflowId: string, folder: ScheduleFolder | null): void;
}

export const useScheduleFolders = create<ScheduleFoldersState>((set, get) => ({
  byWorkflow: load(),
  set: (workflowId, folder) => {
    const byWorkflow = { ...get().byWorkflow };
    if (folder) byWorkflow[workflowId] = folder;
    else delete byWorkflow[workflowId];
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(byWorkflow));
    } catch {
      // Private windows and full storage keep the choice for this session only.
    }
    set({ byWorkflow });
  },
}));
