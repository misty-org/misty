// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { errorText } from "../projectApi";
import {
  filesApi,
  type DirEntry,
  type FileContent,
  type FileTreeColor,
  type RepositorySummary,
} from "./filesApi";
import { useFileIndex } from "./fileIndex";
import { isUnder, joinPath, treeLineage } from "./paths";
import { nextChainDir } from "./treeChain";
import { useTreePreferences } from "./treePreferences";

export { fileName, joinPath, parentPath } from "./paths";

export const treeKey = (root: string) => `misty.fileTree:${root}`;
export const tabsKey = (root: string) => `misty.editorTabs:${root}`;
let treeGeneration = 0;

function readStored<T>(key: string, parse: (value: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the tree still works for this visit.
  }
}

/** `expanded` without `dir` and every folder under it. */
function withoutSubtree(expanded: Record<string, true>, dir: string): Record<string, true> {
  const prefix = joinPath(dir, "");
  return Object.fromEntries(
    Object.entries(expanded).filter(([key]) => key !== dir && !key.startsWith(prefix)),
  );
}

/** The listing entry for a tree path, from its parent's loaded level. */
function treeEntry(
  state: { root: string; children: Record<string, DirEntry[]> },
  path: string,
): DirEntry | undefined {
  const lineage = treeLineage(state.root, path);
  const parent = lineage?.[lineage.length - 2];
  if (parent === undefined) return undefined;
  // Sliced, not fileName(): on macOS and Linux a name may hold "\".
  const name = path.slice(joinPath(parent, "").length);
  return state.children[parent]?.find((entry) => entry.name === name);
}

/** Expanded paths whose every folder from the root down is expanded too. */
function reachableExpanded(root: string, expanded: Record<string, true>): Record<string, true> {
  const reachable: Record<string, true> = {};
  for (const path of Object.keys(expanded)) {
    if (treeLineage(root, path)?.every((dir) => expanded[dir])) reachable[path] = true;
  }
  return reachable;
}

function readExpanded(root: string): Record<string, true> {
  const saved = root
    ? readStored(treeKey(root), (value) => {
        const paths = (value as { expanded?: unknown } | null)?.expanded;
        if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) return null;
        return reachableExpanded(root, Object.fromEntries(paths.map((path) => [path, true])));
      })
    : null;
  return saved ?? (root ? { [root]: true } : {});
}

interface SavedTabs {
  open: string[];
  active: string | null;
}

function readTabs(root: string): SavedTabs {
  const saved = readStored(tabsKey(root), (value) => {
    const tabs = value as Partial<SavedTabs> | null;
    if (!Array.isArray(tabs?.open)) return null;
    const open = tabs.open.filter(
      (path): path is string => typeof path === "string" && isUnder(path, root),
    );
    const active =
      typeof tabs.active === "string" && open.includes(tabs.active) ? tabs.active : null;
    return { open, active };
  });
  return saved ?? { open: [], active: null };
}

/** Newest listing request per folder. Listings run off the main thread, so two of one folder (a
 * refresh and a post-rename re-read) can come back out of order; only the newest may write.
 * Cleared with each tree (root switch), which bounds it. */
const listingSeq = new Map<string, number>();

/** Lists `path` for the tree with Git-ignore flags bounded by the root. Resolves null (errors
 * included) once a newer listing of the same folder has started. */
async function listTreeDir(path: string, root: string): Promise<DirEntry[] | null> {
  const seq = (listingSeq.get(path) ?? 0) + 1;
  listingSeq.set(path, seq);
  const latest = () => listingSeq.get(path) === seq;
  try {
    const entries = await filesApi.listDir(path, root);
    return latest() ? entries : null;
  } catch (error) {
    if (!latest()) return null;
    throw error;
  }
}

/** The tree's own copy and paste, by path; paste copies. */
export interface TreeClipboard {
  path: string;
  isDir: boolean;
  /** The system clipboard's change count read right after this item's Copy tried to put it
   * there, whether or not that landed. `null`: the system keeps none; absent: not known. A rename
   * remaps `path` and keeps this, so Paste can tell the item is still the newest copy. */
  osChangeCount?: number | null;
}

interface OpenFileState {
  path: string;
  /** Null until the first read lands. */
  content: FileContent | null;
  loading: boolean;
  error: string | null;
  /** Bumped on every successful (re)load, so the editor resets its draft. */
  loadNonce: number;
}

export type SearchMode = "files" | "text";

interface FilesStore {
  /** The folder the tree shows; "" while none is linked. */
  root: string;
  /** Folder path → its loaded entries (folders first). Missing means not read yet. */
  children: Record<string, DirEntry[]>;
  loadingDirs: Record<string, true>;
  dirErrors: Record<string, string>;
  expanded: Record<string, true>;
  /** The top folder of each nested repository → its branch and counts. */
  repositories: Record<string, RepositorySummary>;
  /** Loaded level → each entry's Git color. */
  fileColors: Record<string, Record<string, FileTreeColor>>;
  selectedPath: string | null;
  selectedIsDir: boolean;
  /** Open file tabs, in order. Kept per folder across restarts. */
  openFiles: string[];
  fileStates: Record<string, OpenFileState>;
  /** The tab shown; null shows the tree. */
  activeFilePath: string | null;
  /** Paths with unsaved edits, reported by the editor. */
  dirtyPaths: Record<string, true>;
  /** What the menu's Copy staged for Paste. */
  clipboard: TreeClipboard | null;
  /** The folder the search overlay looks in; null while it is closed. */
  searchRoot: string | null;
  searchMode: SearchMode;
  refreshing: boolean;

  setRoot(path: string): void;
  ensureDir(path: string): Promise<void>;
  toggleDir(path: string): Promise<void>;
  toggleCompactDir(paths: string[]): Promise<void>;
  /** Expands `path` and every folder above it, then reads it. A merged row only opens when all
   * of its folders are expanded. */
  revealDir(path: string): Promise<void>;
  expandLoadedDirs(): void;
  collapseAllDirs(): void;
  /** Reads a folder again, only if it was read before. */
  invalidateDir(path: string): Promise<void>;
  /** Reads every loaded level the tree can still show again, collapsed ones included, and open
   * folders not read yet. */
  refreshTree(): Promise<void>;
  loadGitStatus(levels: Record<string, DirEntry[]>): Promise<void>;
  selectPath(path: string | null, isDir?: boolean): void;
  /** Opens a file as a tab, or shows its tab. */
  openFile(path: string): Promise<void>;
  saveFile(path: string, content: string): Promise<string>;
  /** Shows an open tab; null shows the tree. */
  activateFile(path: string | null): void;
  reloadFile(path: string): Promise<void>;
  closeFile(path: string): void;
  moveOpenFile(path: string, toIndex: number): void;
  setClipboard(item: TreeClipboard | null): void;
  /** Drops what the tree holds at or under a removed path and closes its tabs. */
  removeTreePath(path: string): void;
  /** Moves what the tree holds, and open tabs, after a rename. */
  remapTreePath(from: string, to: string): void;
  setFileDirty(path: string, dirty: boolean): void;
  openSearch(searchRoot: string, mode?: SearchMode): void;
  closeSearch(): void;
}

/** Levels a refresh reads again: the root, every loaded level reachable through entries the tree
 * shows (collapsed ones too, so they never reopen with an old listing; Git actions rely on this),
 * and open folders not read yet or that failed (the retry). Folders the Git-ignore switch hides,
 * and all under them, are skipped. */
function refreshTargets(
  state: Pick<FilesStore, "root" | "children" | "expanded">,
  hideIgnored: boolean,
): Set<string> {
  const dirs = new Set([state.root]);
  const visit = (dir: string, open: boolean) => {
    for (const entry of state.children[dir] ?? []) {
      if (!entry.isDir || (hideIgnored && entry.ignored)) continue;
      const path = joinPath(dir, entry.name);
      const isOpen = open && !!state.expanded[path];
      if (state.children[path]) {
        dirs.add(path);
        visit(path, isOpen);
      } else if (isOpen) {
        dirs.add(path);
      }
    }
  };
  visit(state.root, !!state.expanded[state.root]);
  return dirs;
}

const emptyFile = (path: string): OpenFileState => ({
  path,
  content: null,
  loading: false,
  error: null,
  loadNonce: 0,
});

export const useFilesStore = create<FilesStore>((set, get) => ({
  root: "",
  children: {},
  loadingDirs: {},
  dirErrors: {},
  expanded: {},
  repositories: {},
  fileColors: {},
  selectedPath: null,
  selectedIsDir: false,
  openFiles: [],
  fileStates: {},
  activeFilePath: null,
  dirtyPaths: {},
  clipboard: null,
  searchRoot: null,
  searchMode: "files",
  refreshing: false,

  setRoot: (path) => {
    const root = path.trim();
    if (root === get().root) return;
    treeGeneration += 1;
    listingSeq.clear();
    const tabs = root ? readTabs(root) : { open: [], active: null };
    set({
      root,
      refreshing: false,
      children: {},
      loadingDirs: {},
      dirErrors: {},
      expanded: readExpanded(root),
      repositories: {},
      fileColors: {},
      selectedPath: null,
      selectedIsDir: false,
      // Each folder keeps its own tabs; their text is read when they are first shown.
      openFiles: tabs.open,
      fileStates: Object.fromEntries(tabs.open.map((open) => [open, emptyFile(open)])),
      activeFilePath: tabs.active,
      dirtyPaths: {},
      searchRoot: null,
    });
    if (root) void get().ensureDir(root);
    if (tabs.active) void get().reloadFile(tabs.active);
  },

  ensureDir: async (path) => {
    const state = get();
    if (state.children[path] || state.loadingDirs[path]) return;
    const generation = treeGeneration;
    set((current) => ({ loadingDirs: { ...current.loadingDirs, [path]: true } }));
    try {
      const entries = await listTreeDir(path, state.root);
      if (generation !== treeGeneration) return;
      set((current) => {
        const loadingDirs = { ...current.loadingDirs };
        delete loadingDirs[path];
        // A newer listing (a refresh) already wrote this level.
        if (!entries) return { loadingDirs };
        const dirErrors = { ...current.dirErrors };
        delete dirErrors[path];
        return { children: { ...current.children, [path]: entries }, loadingDirs, dirErrors };
      });
      if (entries) await get().loadGitStatus({ [path]: entries });
    } catch (error) {
      if (generation !== treeGeneration) return;
      set((current) => {
        const loadingDirs = { ...current.loadingDirs };
        delete loadingDirs[path];
        return { loadingDirs, dirErrors: { ...current.dirErrors, [path]: errorText(error) } };
      });
    }
  },

  loadGitStatus: async (levels) => {
    const generation = treeGeneration;
    const requests = Object.entries(levels).map(([path, entries]) => ({
      path,
      files: entries.filter((entry) => !entry.name.startsWith(".")).map((entry) => entry.name),
      directories: entries.filter((entry) => entry.isDir).map((entry) => entry.name),
    }));
    if (requests.length === 0) return;
    try {
      const result = await filesApi.gitTreeStatus(requests);
      if (generation !== treeGeneration) return;
      set((state) => {
        const repositories = { ...state.repositories };
        const fileColors = { ...state.fileColors };
        for (const request of requests) {
          delete repositories[request.path];
          for (const name of request.directories) delete repositories[joinPath(request.path, name)];
          fileColors[request.path] = result.fileColors[request.path] ?? {};
        }
        for (const summary of result.repositories) repositories[summary.path] = summary;
        return { repositories, fileColors };
      });
    } catch {
      // Git colors are extra; the tree works without them.
    }
  },

  toggleDir: async (path) => {
    const state = get();
    if (state.expanded[path]) {
      set({ expanded: withoutSubtree(state.expanded, path) });
      return;
    }
    set((current) => ({ expanded: { ...current.expanded, [path]: true } }));
    await get().ensureDir(path);
  },

  toggleCompactDir: async (paths) => {
    if (paths.length === 0) return;
    const generation = treeGeneration;
    if (paths.every((path) => get().expanded[path])) {
      set((state) => ({ expanded: withoutSubtree(state.expanded, paths[0]) }));
      return;
    }
    let path = paths[paths.length - 1];
    // Every folder of one chain shares its Git-ignore state (nextChainDir).
    const ignored = !!treeEntry(get(), path)?.ignored;
    set((state) => ({
      expanded: { ...state.expanded, ...Object.fromEntries(paths.map((part) => [part, true])) },
    }));
    for (;;) {
      await get().ensureDir(path);
      // A refresh that started meanwhile superseded this first listing and may land later; read
      // once more so the chain doesn't stop here.
      if (!get().children[path] && !get().dirErrors[path]) await get().ensureDir(path);
      if (generation !== treeGeneration) return;
      const state = get();
      // The root row is never merged, so it opens one level only.
      if (!state.expanded[path] || path === state.root) return;
      const next = nextChainDir(path, ignored, {
        children: state.children,
        loadingDirs: state.loadingDirs,
        dirErrors: state.dirErrors,
        repositories: state.repositories,
        hideIgnored: useTreePreferences.getState().hideIgnored,
      });
      if (!next) return;
      path = joinPath(path, next.name);
      const opened = path;
      set((current) => ({ expanded: { ...current.expanded, [opened]: true } }));
    }
  },

  revealDir: async (path) => {
    const lineage = treeLineage(get().root, path);
    if (!lineage) return;
    set((state) => ({
      expanded: { ...state.expanded, ...Object.fromEntries(lineage.map((dir) => [dir, true])) },
    }));
    await get().ensureDir(path);
  },

  expandLoadedDirs: () => {
    const { root, children, expanded: current } = get();
    if (!root) return;
    const hideIgnored = useTreePreferences.getState().hideIgnored;
    // Folders already open stay open, ones still loading included.
    const expanded: Record<string, true> = { ...current, [root]: true };
    const visit = (dir: string) => {
      for (const entry of children[dir] ?? []) {
        if (!entry.isDir || (hideIgnored && entry.ignored)) continue;
        const path = joinPath(dir, entry.name);
        if (!children[path]) continue;
        expanded[path] = true;
        visit(path);
      }
    };
    visit(root);
    set({ expanded });
  },

  collapseAllDirs: () => {
    const root = get().root;
    set({ expanded: root ? { [root]: true } : {} });
  },

  invalidateDir: async (path) => {
    if (!get().children[path]) return;
    const generation = treeGeneration;
    try {
      const entries = await listTreeDir(path, get().root);
      if (generation !== treeGeneration || !entries) return;
      set((state) => ({ children: { ...state.children, [path]: entries } }));
      await get().loadGitStatus({ [path]: entries });
    } catch {
      // The old listing stays; toggling the folder reads it again.
    }
  },

  refreshTree: async () => {
    const state = get();
    if (!state.root || state.refreshing) return;
    const generation = treeGeneration;
    set({ refreshing: true });
    useFileIndex.getState().invalidate(state.root);
    try {
      const hideIgnored = useTreePreferences.getState().hideIgnored;
      const dirs = refreshTargets(state, hideIgnored);
      const levels: Record<string, DirEntry[]> = {};
      await Promise.all(
        [...dirs].map(async (dir) => {
          try {
            const entries = await listTreeDir(dir, state.root);
            // A superseded listing leaves this level, and its Git pass, to the newer one.
            if (generation !== treeGeneration || !entries) return;
            levels[dir] = entries;
            set((current) => {
              const dirErrors = { ...current.dirErrors };
              delete dirErrors[dir];
              return { children: { ...current.children, [dir]: entries }, dirErrors };
            });
          } catch {
            if (generation !== treeGeneration) return;
            if (state.children[dir]) levels[dir] = state.children[dir];
          }
        }),
      );
      if (generation !== treeGeneration) return;
      // Judged on the fresh listings: levels the tree can no longer show (hidden by the switch,
      // or no longer listed by their parent, as after a checkout) are dropped and read fresh when
      // shown again, rather than coming back with an old listing.
      const live = refreshTargets(get(), hideIgnored);
      const dropped = Object.keys(get().children).filter((dir) => !live.has(dir));
      if (dropped.length > 0) {
        set((current) => {
          const children = { ...current.children };
          const fileColors = { ...current.fileColors };
          for (const dir of dropped) {
            delete children[dir];
            delete fileColors[dir];
          }
          return { children, fileColors };
        });
      }
      await get().loadGitStatus(
        Object.fromEntries(Object.entries(levels).filter(([dir]) => live.has(dir))),
      );
    } finally {
      if (generation === treeGeneration) set({ refreshing: false });
    }
  },

  selectPath: (path, isDir = false) => set({ selectedPath: path, selectedIsDir: isDir }),

  openFile: async (path) => {
    const known = get().fileStates[path];
    if (known) {
      set({ activeFilePath: path, selectedPath: path, selectedIsDir: false });
      if (!known.content && !known.loading) await get().reloadFile(path);
      return;
    }
    set((state) => ({
      openFiles: [...state.openFiles, path],
      fileStates: { ...state.fileStates, [path]: { ...emptyFile(path), loading: true } },
      activeFilePath: path,
      selectedPath: path,
      selectedIsDir: false,
    }));
    await get().reloadFile(path);
  },

  saveFile: async (path, content) => {
    const entry = get().fileStates[path];
    if (!entry?.content || entry.content.kind !== "text" || entry.content.truncated) {
      throw new Error("This file can't be edited here.");
    }
    await filesApi.writeFile(path, content);
    set((state) => {
      const current = state.fileStates[path];
      if (!current?.content) return state;
      return {
        fileStates: {
          ...state.fileStates,
          [path]: { ...current, content: { ...current.content, text: content } },
        },
      };
    });
    return content;
  },

  activateFile: (path) => {
    if (path === null) {
      set({ activeFilePath: null });
      return;
    }
    const known = get().fileStates[path];
    if (!known) return;
    set({ activeFilePath: path });
    if (!known.content && !known.loading) void get().reloadFile(path);
  },

  reloadFile: async (path) => {
    if (!get().fileStates[path]) return;
    set((state) => {
      const current = state.fileStates[path];
      if (!current) return state;
      return {
        fileStates: { ...state.fileStates, [path]: { ...current, loading: true, error: null } },
      };
    });
    try {
      const content = await filesApi.readFile(path);
      set((state) => {
        const current = state.fileStates[path];
        if (!current) return state;
        return {
          fileStates: {
            ...state.fileStates,
            [path]: { ...current, content, loading: false, loadNonce: current.loadNonce + 1 },
          },
        };
      });
    } catch (error) {
      const message = errorText(error);
      set((state) => {
        const current = state.fileStates[path];
        if (!current) return state;
        return {
          fileStates: {
            ...state.fileStates,
            [path]: { ...current, loading: false, error: message },
          },
        };
      });
    }
  },

  closeFile: (path) =>
    set((state) => {
      if (!state.fileStates[path]) return state;
      const openFiles = state.openFiles.filter((open) => open !== path);
      const fileStates = { ...state.fileStates };
      delete fileStates[path];
      const dirtyPaths = { ...state.dirtyPaths };
      delete dirtyPaths[path];
      let activeFilePath = state.activeFilePath;
      if (activeFilePath === path) {
        const index = state.openFiles.indexOf(path);
        // The tab that slid into the closed one's place, or the last; the tree when none is left.
        activeFilePath = openFiles[Math.min(index, openFiles.length - 1)] ?? null;
      }
      return { openFiles, fileStates, dirtyPaths, activeFilePath };
    }),

  moveOpenFile: (path, toIndex) =>
    set((state) => {
      const from = state.openFiles.indexOf(path);
      if (from < 0) return state;
      const openFiles = [...state.openFiles];
      openFiles.splice(from, 1);
      openFiles.splice(Math.max(0, Math.min(toIndex, openFiles.length)), 0, path);
      return { openFiles };
    }),

  setClipboard: (item) => set({ clipboard: item }),

  removeTreePath: (path) => {
    const prune = <T>(map: Record<string, T>) =>
      Object.fromEntries(Object.entries(map).filter(([key]) => !isUnder(key, path)));
    set((state) => ({
      children: prune(state.children),
      expanded: prune(state.expanded),
      loadingDirs: prune(state.loadingDirs),
      dirErrors: prune(state.dirErrors),
      repositories: prune(state.repositories),
      fileColors: prune(state.fileColors),
      selectedPath:
        state.selectedPath && isUnder(state.selectedPath, path) ? null : state.selectedPath,
      clipboard: state.clipboard && isUnder(state.clipboard.path, path) ? null : state.clipboard,
    }));
    for (const open of [...get().openFiles]) {
      if (isUnder(open, path)) get().closeFile(open);
    }
  },

  remapTreePath: (from, to) => {
    const mapPath = (path: string) => (isUnder(path, from) ? to + path.slice(from.length) : path);
    const remap = <T>(map: Record<string, T>) =>
      Object.fromEntries(Object.entries(map).map(([key, value]) => [mapPath(key), value]));
    set((state) => {
      const fileStates: Record<string, OpenFileState> = {};
      for (const [path, entry] of Object.entries(state.fileStates)) {
        const moved = mapPath(path);
        fileStates[moved] = moved === path ? entry : { ...entry, path: moved };
      }
      return {
        children: remap(state.children),
        expanded: remap(state.expanded),
        loadingDirs: remap(state.loadingDirs),
        dirErrors: remap(state.dirErrors),
        repositories: remap(state.repositories),
        fileColors: remap(state.fileColors),
        selectedPath: state.selectedPath ? mapPath(state.selectedPath) : state.selectedPath,
        // The same object unless its own path moved: a Copy whose clipboard write is still in
        // flight records its change count onto that object.
        clipboard:
          state.clipboard && mapPath(state.clipboard.path) !== state.clipboard.path
            ? { ...state.clipboard, path: mapPath(state.clipboard.path) }
            : state.clipboard,
        openFiles: state.openFiles.map(mapPath),
        fileStates,
        dirtyPaths: remap(state.dirtyPaths),
        activeFilePath: state.activeFilePath ? mapPath(state.activeFilePath) : null,
      };
    });
  },

  setFileDirty: (path, dirty) =>
    set((state) => {
      if (dirty === !!state.dirtyPaths[path]) return state;
      const dirtyPaths = { ...state.dirtyPaths };
      if (dirty) dirtyPaths[path] = true;
      else delete dirtyPaths[path];
      return { dirtyPaths };
    }),

  openSearch: (searchRoot, mode = "files") => set({ searchRoot, searchMode: mode }),
  closeSearch: () => set({ searchRoot: null }),
}));

// Each folder remembers which folders were open and which files were open as tabs.
useFilesStore.subscribe((state, previous) => {
  if (!state.root) return;
  if (state.expanded !== previous.expanded) {
    writeStored(treeKey(state.root), {
      expanded: Object.keys(reachableExpanded(state.root, state.expanded)),
    });
  }
  if (state.openFiles !== previous.openFiles || state.activeFilePath !== previous.activeFilePath) {
    writeStored(tabsKey(state.root), { open: state.openFiles, active: state.activeFilePath });
  }
});
