import { create } from "zustand";
import { agentAccountId } from "../../personal/agentAccount";
import { readDeviceState, updateDeviceState } from "./deviceState";

/** What a person set for one linked folder on this device. Every field is optional. Launch
 * scripts keep their own list (launch-script/launchScripts.ts), and added programs are kept
 * natively, where no window can name one. */
interface FolderSettings {
  /** The app the "Open in" button opens the folder in, by its id. */
  openIn?: string;
}

const scope = (folder: string) => `project-folder:${agentAccountId()}:${folder}`;

/**
 * Each folder's settings once read, so the header's buttons share one copy and update together.
 * Reads go to `misty.db` the first time a folder is shown.
 */
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
