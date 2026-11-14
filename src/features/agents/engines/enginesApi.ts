import { useEffect } from "react";
import { create } from "zustand";
import { readApiCache, writeApiCache } from "@/api/cache/api-cache";
import { refreshCachedResource, useCachedResource } from "@/api/cache/cached-resource";
import { invoke } from "@/native/invoke";
import { spaceWindow } from "@/features/app-windows";
import { agentAccountId } from "../personal/agentAccount";
import { modelName, rememberModelNames } from "./modelNames";

/** An agent engine Misty has an adapter for, and whether it is installed on this computer. */
export interface EngineInfo {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
  /** The engine's own modes offered here (`engineModes.ts`); native code decides what each passes. */
  modes?: Array<{ id: string; label: string; kind: "asks" | "edits" | "plans" | "no_asking" }>;
}

/** Misty's own runtime, which needs nothing installed. */
export const mistyEngine = "misty";

/** Where the engine list is kept: one copy for every screen, saved on this computer. */
const enginesKey = "engines/list";
const loadEngines = () => invoke<EngineInfo[]>("engines_list");

/**
 * The engines on this computer, asked of native code afresh (it runs each CLI's `--version`).
 * Every screen showing them gets the answer too, and two asks at once share one.
 */
export const listEngines = () =>
  refreshCachedResource(enginesKey, loadEngines, "device", { join: true });

/**
 * The engines, for a screen: the last list paints at once, even right after launch, and a fresh
 * one follows behind it. `loading` is true only the very first time, with nothing saved.
 */
export const useEnginesList = () =>
  useCachedResource(enginesKey, loadEngines, { persist: "device" });

/** A model an engine can be asked for; `default` marks the one it uses when none is named. */
export interface EngineModel {
  /** What the engine is asked for ("opus", "default", "gpt-5.5"). */
  id: string;
  /** Its name as the engine gives it ("Opus 5.5", "GPT-5.6-Luna"), else its id. */
  label: string;
  /** The muted line under it: its concrete id, or what a selector stands for. */
  detail?: string | null;
  /** The model it runs, by name ("Opus 5.5" for Claude Code's "default"). */
  runs?: string | null;
  /**
   * Its reasoning-effort levels as the engine lists them, weakest first, with the engine's own
   * names and notes; null when the engine doesn't say, empty when the model takes none.
   */
  efforts?: EngineEffort[] | null;
  /** The level the engine itself would use for it (its remembered one, else its default). */
  defaultEffort?: string | null;
  contextWindow?: number | null;
  /** "more" when the engine's own menu keeps it under "More models". */
  section?: "main" | "more" | null;
  /** The engine's own fast mode for it, by the engine's name, and what turns it on. */
  fast?: { label: string; tier: string } | null;
  /** A note the engine shows with it. */
  notice?: string | null;
  /** The engine's own current pick, which a chat that names no model gets. */
  default: boolean;
}

/** One reasoning-effort level as an engine offers it for a model. */
export interface EngineEffort {
  /** What the run passes ("xhigh"). */
  id: string;
  /** The engine's own name for it ("Extra"). */
  name?: string;
  /** The engine's own line about it. */
  description?: string;
  /** A short tag the engine puts on it ("Recommended"). */
  badge?: string;
}

/** The engine's own models, then the model names the person added for it in Settings › Engines. */
export async function listEngineModels(engine: string): Promise<EngineModel[]> {
  const [models, settings] = await Promise.all([
    invoke<EngineModel[]>("engine_models", { engine }),
    invoke<{ customModels?: Record<string, string[]> }>("engine_settings_get").catch(() => null),
  ]);
  const known = new Set(models.map((model) => model.id));
  const added = (settings?.customModels?.[engine] ?? [])
    .filter((id) => id.trim() && !known.has(id))
    .map((id): EngineModel => ({ id, label: id, default: false }));
  // Each model by the engine's own name; the names are kept for ids shown elsewhere.
  const all = [...models, ...added].map((model) => ({
    ...model,
    label: modelName(model.label ?? "", model.id),
  }));
  rememberModelNames(all);
  return all;
}

const modelCache = new Map<string, Promise<EngineModel[]>>();
// Settings › Engines changed (a channel, or the model names the person added): read them again.
if (typeof window !== "undefined")
  window.addEventListener("misty:engine-channels-changed", () => modelCache.clear());

/** An engine's models, read once and shared by the composer and the run that sends its turn. */
export function engineModels(engine: string): Promise<EngineModel[]> {
  let pending = modelCache.get(engine);
  if (!pending) {
    pending = listEngineModels(engine).catch(() => []);
    modelCache.set(engine, pending);
  }
  return pending;
}

/** The model a chat runs: the one named, else the engine's own default. */
export function modelNamed(
  models: readonly EngineModel[] | undefined,
  id: string,
): EngineModel | undefined {
  return id ? models?.find((model) => model.id === id) : models?.find((model) => model.default);
}

/** One of an engine's slash commands or skills, and what the composer inserts to use it. */
export interface EngineCatalogItem {
  name: string;
  description: string;
  source: "builtin" | "user" | "project";
  insert: string;
  argumentHint?: string;
  /** Who runs it: the engine, sent as the next message, or Misty, out of turn
   * (`engineCommands.ts`). */
  runs?: "turn" | "misty";
}

export interface EngineCatalog {
  commands: EngineCatalogItem[];
  skills: EngineCatalogItem[];
}

/** An engine's commands and skills, from its own folders and the chat's linked folder. */
export const engineCatalog = (engine: string, folder: string) =>
  invoke<EngineCatalog>("engine_catalog", { account: agentAccountId(), engine, folder });

/** A file or folder inside a linked folder, for the composer's `@` menu. */
interface FoundFile {
  path: string;
  relative: string;
  isDir: boolean;
}

export const findFiles = (folder: string, query: string) =>
  invoke<FoundFile[]>("project_find_files", { account: agentAccountId(), folder, query });

/** The Space this window shows, as the key its linked folders are kept under. */
export const currentSpaceKey = () => spaceWindow().spaceId ?? "";

/**
 * What the person set for a Space's linked folders on this device, kept in `misty.db` and never
 * synced: the folder in use, a name for each, their order, and which are archived (still linked,
 * out of the way). Adapted from desktop-cc-gui's workspace grouping (MIT, Copyright (c) 2026
 * zhukunpenglinyutong).
 */
interface SpaceFolderPrefs {
  chosen?: string;
  names?: Record<string, string>;
  order?: string[];
  archived?: string[];
}

interface SpaceFoldersState {
  /** Each Space's linked folders on this computer, by Space key, once loaded, in link order. */
  folders: Record<string, string[]>;
  /** The folder a Space's chats and panels work in; the first one in order unless another is picked. */
  chosen: Record<string, string>;
  /** Each Space's names, order and archive for its folders. */
  prefs: Record<string, SpaceFolderPrefs>;
  load(space: string): Promise<string[]>;
  link(space: string): Promise<string | null>;
  unlink(space: string, path: string): Promise<void>;
  choose(space: string, path: string): void;
  /** Names a folder in lists; an empty name goes back to the folder's own. */
  rename(space: string, path: string, name: string): Promise<void>;
  /** Moves a folder to `index` in the Space's order. */
  move(space: string, path: string, index: number): Promise<void>;
  archive(space: string, path: string, archived: boolean): Promise<void>;
}

const prefsScope = (space: string) => `project-folders:${agentAccountId()}:${space}`;

/**
 * The last folders and settings each Space had on this computer, saved so a relaunch paints them at
 * once while native code answers. Folder paths carry no secret.
 */
const savedFoldersKey = (space: string) => `space-folders:${agentAccountId()}:${space}`;

interface SavedFolders {
  folders: string[];
  prefs: SpaceFolderPrefs;
}

/** Spaces whose folder in use came from the saved copy: the fresh answer replaces it. */
const restoredChoice = new Set<string>();

interface Stored<T> {
  revision: number;
  state: T | null;
}

async function savePrefs(space: string, change: (prefs: SpaceFolderPrefs) => SpaceFolderPrefs) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await invoke<Stored<SpaceFolderPrefs>>("settings_session_state", {
      scope: prefsScope(space),
    });
    const next = change(current.state ?? {});
    try {
      await invoke("settings_session_commit", {
        scope: prefsScope(space),
        revision: current.revision,
        document: next,
      });
      return next;
    } catch (error) {
      if (!String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
    }
  }
  throw new Error("This changed in another window. Try again.");
}

export const useSpaceFolders = create<SpaceFoldersState>((set, get) => {
  const update = async (space: string, change: (prefs: SpaceFolderPrefs) => SpaceFolderPrefs) => {
    // Shown at once; the stored copy follows, and wins if another window wrote meanwhile.
    set({ prefs: { ...get().prefs, [space]: change(get().prefs[space] ?? {}) } });
    const saved = await savePrefs(space, change);
    set({
      prefs: { ...get().prefs, [space]: saved },
      chosen: saved.chosen ? { ...get().chosen, [space]: saved.chosen } : get().chosen,
    });
  };
  return {
    folders: {},
    chosen: {},
    prefs: {},
    async load(space) {
      // With nothing shown yet, the saved copy paints first; it never overwrites a fresh answer.
      if (!get().folders[space]) {
        void readApiCache("device", savedFoldersKey(space)).then((hit) => {
          if (!hit || get().folders[space]) return;
          try {
            const saved = JSON.parse(hit.body) as SavedFolders;
            if (!Array.isArray(saved.folders)) return;
            const chosen = { ...get().chosen };
            if (!chosen[space] && saved.prefs?.chosen) {
              chosen[space] = saved.prefs.chosen;
              restoredChoice.add(space);
            }
            set({
              folders: { ...get().folders, [space]: saved.folders },
              prefs: { ...get().prefs, [space]: saved.prefs ?? {} },
              chosen,
            });
          } catch {
            /* a copy that can't be read is a miss */
          }
        });
      }
      const [folders, stored] = await Promise.all([
        invoke<string[]>("space_folder_list", { account: agentAccountId(), space }),
        invoke<Stored<SpaceFolderPrefs>>("settings_session_state", { scope: prefsScope(space) })
          .then((found) => found.state ?? {})
          .catch(() => get().prefs[space] ?? {}),
      ]);
      const chosen = { ...get().chosen };
      // A pick made in this window stays; otherwise the remembered one comes back. One painted
      // from the saved copy gives way to what is stored now.
      if (restoredChoice.delete(space)) {
        if (stored.chosen) chosen[space] = stored.chosen;
        else delete chosen[space];
      } else if (!chosen[space] && stored.chosen) chosen[space] = stored.chosen;
      set({
        folders: { ...get().folders, [space]: folders },
        prefs: { ...get().prefs, [space]: stored },
        chosen,
      });
      void writeApiCache(
        "device",
        savedFoldersKey(space),
        JSON.stringify({ folders, prefs: stored } satisfies SavedFolders),
      );
      return folders;
    },
    async link(space) {
      const path = await invoke<string | null>("space_folder_link", {
        account: agentAccountId(),
        space,
      });
      if (!path) return null;
      await get().load(space);
      get().choose(space, path);
      return path;
    },
    async unlink(space, path) {
      await invoke<void>("space_folder_unlink", { account: agentAccountId(), space, path });
      const chosen = { ...get().chosen };
      if (chosen[space] === path) delete chosen[space];
      set({ chosen });
      await update(space, (prefs) => ({
        ...prefs,
        chosen: prefs.chosen === path ? undefined : prefs.chosen,
        order: prefs.order?.filter((item) => item !== path),
        archived: prefs.archived?.filter((item) => item !== path),
        names: Object.fromEntries(
          Object.entries(prefs.names ?? {}).filter(([key]) => key !== path),
        ),
      })).catch(() => undefined);
      await get().load(space);
    },
    choose(space, path) {
      restoredChoice.delete(space);
      set({ chosen: { ...get().chosen, [space]: path } });
      void update(space, (prefs) => ({ ...prefs, chosen: path })).catch(() => undefined);
    },
    rename(space, path, name) {
      const trimmed = name.trim();
      return update(space, (prefs) => {
        const names = { ...prefs.names };
        if (trimmed && trimmed !== folderName(path)) names[path] = trimmed;
        else delete names[path];
        return { ...prefs, names };
      });
    },
    move(space, path, index) {
      return update(space, (prefs) => {
        const order = orderFolders(get().folders[space] ?? [], prefs).filter(
          (item) => item !== path,
        );
        order.splice(Math.max(0, Math.min(index, order.length)), 0, path);
        return { ...prefs, order };
      });
    },
    archive(space, path, archived) {
      return update(space, (prefs) => {
        const rest = (prefs.archived ?? []).filter((item) => item !== path);
        return {
          ...prefs,
          archived: archived ? [...rest, path] : rest,
          // An archived folder isn't worked in; the next one in order takes over.
          chosen: archived && prefs.chosen === path ? undefined : prefs.chosen,
        };
      }).then(() => {
        if (archived && get().chosen[space] === path) {
          const chosen = { ...get().chosen };
          delete chosen[space];
          set({ chosen });
        }
      });
    },
  };
});

/** `linked` in the person's order: the ones they placed first, then any linked since. */
export function orderFolders(linked: string[], prefs: SpaceFolderPrefs): string[] {
  const placed = (prefs.order ?? []).filter((path) => linked.includes(path));
  return [...placed, ...linked.filter((path) => !placed.includes(path))];
}

/** A Space's folders in order, archived ones left out unless asked for. */
export function spaceFolderList(
  state: Pick<SpaceFoldersState, "folders" | "prefs">,
  space: string,
  includeArchived = false,
): string[] {
  const prefs = state.prefs[space] ?? {};
  const ordered = orderFolders(state.folders[space] ?? [], prefs);
  return includeArchived ? ordered : ordered.filter((path) => !prefs.archived?.includes(path));
}

/** What a folder is called in lists: the person's name for it, or its own. */
export function folderLabel(
  state: Pick<SpaceFoldersState, "prefs">,
  space: string,
  path: string,
): string {
  return state.prefs[space]?.names?.[path] ?? folderName(path);
}

/** The folder a Space works in, out of what is loaded: the picked one if it is still linked and
 * not archived, else the first in order. */
export function folderOf(
  state: Pick<SpaceFoldersState, "folders" | "chosen"> & {
    prefs?: Record<string, SpaceFolderPrefs>;
  },
  space: string,
) {
  const prefs = state.prefs?.[space] ?? {};
  const active = orderFolders(state.folders[space] ?? [], prefs).filter(
    (path) => !prefs.archived?.includes(path),
  );
  const picked = state.chosen[space];
  return picked && active.includes(picked) ? picked : (active[0] ?? "");
}

/** The folder an engine's turn runs in for this Space, read fresh so a new link counts at once. */
export async function engineFolder(space: string): Promise<string> {
  const store = useSpaceFolders.getState();
  await store.load(space).catch(() => []);
  return folderOf(useSpaceFolders.getState(), space);
}

/** A folder's own name, for a row that has no room for its whole path. */
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const noLinkedFolders: string[] = [];

/** This window's Space's linked folders and the one picked, loaded on first use. */
export function useLinkedFolders(): { folders: string[]; picked?: string } {
  const space = currentSpaceKey();
  const folders = useSpaceFolders((state) => state.folders[space]);
  const picked = useSpaceFolders((state) => state.chosen[space]);
  useEffect(() => {
    if (!folders)
      void useSpaceFolders
        .getState()
        .load(space)
        .catch(() => []);
  }, [space, folders]);
  return { folders: folders ?? noLinkedFolders, picked };
}
