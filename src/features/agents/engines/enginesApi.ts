import { create } from "zustand";
import { invoke } from "@/native/invoke";
import { spaceWindow } from "@/features/app-windows";
import { agentAccountId } from "../personal/agentAccount";

/** An agent engine Misty has an adapter for, and whether it is installed on this computer. */
export interface EngineInfo {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
}

/** Misty's own runtime, which needs nothing installed. */
export const mistyEngine = "misty";

export const listEngines = () => invoke<EngineInfo[]>("engines_list");

/** A model an engine can be asked for; `default` marks the one it uses when none is named. */
export interface EngineModel {
  id: string;
  default: boolean;
}

export const listEngineModels = (engine: string) =>
  invoke<EngineModel[]>("engine_models", { engine });

/** The Space this window shows, as the key its linked folders are kept under. */
export const currentSpaceKey = () => spaceWindow().spaceId ?? "";

interface SpaceFoldersState {
  /** Each Space's linked folders on this computer, by Space key, once loaded. */
  folders: Record<string, string[]>;
  /** The folder a Space's chats and panels work in; the first linked one unless another is picked. */
  chosen: Record<string, string>;
  load(space: string): Promise<string[]>;
  link(space: string): Promise<string | null>;
  unlink(space: string, path: string): Promise<void>;
  choose(space: string, path: string): void;
}

export const useSpaceFolders = create<SpaceFoldersState>((set, get) => ({
  folders: {},
  chosen: {},
  async load(space) {
    const folders = await invoke<string[]>("space_folder_list", {
      account: agentAccountId(),
      space,
    });
    set({ folders: { ...get().folders, [space]: folders } });
    return folders;
  },
  async link(space) {
    const path = await invoke<string | null>("space_folder_link", {
      account: agentAccountId(),
      space,
    });
    if (!path) return null;
    await get().load(space);
    set({ chosen: { ...get().chosen, [space]: path } });
    return path;
  },
  async unlink(space, path) {
    await invoke<void>("space_folder_unlink", { account: agentAccountId(), space, path });
    const chosen = { ...get().chosen };
    if (chosen[space] === path) delete chosen[space];
    set({ chosen });
    await get().load(space);
  },
  choose(space, path) {
    set({ chosen: { ...get().chosen, [space]: path } });
  },
}));

/** The folder a Space works in, out of what is loaded: the picked one if it is still linked. */
export function folderOf(state: Pick<SpaceFoldersState, "folders" | "chosen">, space: string) {
  const linked = state.folders[space] ?? [];
  const picked = state.chosen[space];
  return picked && linked.includes(picked) ? picked : (linked[0] ?? "");
}

/** The folder an engine's turn runs in for this Space, read fresh so a new link counts at once. */
export async function engineFolder(space: string): Promise<string> {
  const store = useSpaceFolders.getState();
  await store.load(space).catch(() => []);
  return folderOf(useSpaceFolders.getState(), space);
}

/** A folder's own name, for a row that has no room for its whole path. */
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
