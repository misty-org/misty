import { create } from "zustand";
import { agentAccountId } from "../../personal/agent_account";
import { readDeviceState, updateDeviceState } from "./device_state";

interface FolderSettings {
  openIn?: string;
}

const scope = (folder: string) => `project-folder:${agentAccountId()}:${folder}`;

export const useFolderSettings = create<{
  byFolder: Record<string, FolderSettings>;
  load(folder: string): Promise<FolderSettings>;
  update(folder: string, patch: Partial<FolderSettings>): Promise<FolderSettings>;
}>((set, get) => ({
  byFolder: {},
  async load(folder) {
    const known = get().byFolder[folder];
    if (known) return known;
    const stored = (await readDeviceState<FolderSettings>(scope(folder))) ?? {};
    set((state) => ({ byFolder: { ...state.byFolder, [folder]: stored } }));
    return stored;
  },
  async update(folder, patch) {
    const saved = await updateDeviceState<FolderSettings>(
      scope(folder),
      () => ({}),
      (current) => ({ ...current, ...patch }),
    );
    set((state) => ({ byFolder: { ...state.byFolder, [folder]: saved } }));
    return saved;
  },
}));
