// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { errorText } from "../project_api";
import {
  filesApi,
  type DirEntry,
  type FileContent,
  type FileTreeColor,
  type RepositorySummary,
} from "./files_api";
import { useFileIndex } from "./file_index";
import { isUnder, joinPath, treeLineage } from "./paths";
import { nextChainDir } from "./tree_chain";
import { useTreePreferences } from "./tree_preferences";
import { keepShownTree, shownTrees } from "./shown_trees";
import { readExpanded, readTabs, saveExpanded, saveTabs } from "./saved_tree_state";

export { fileName, joinPath, parentPath } from "./paths";
export { tabsKey, treeKey } from "./saved_tree_state";

let treeGeneration = 0;

function withoutSubtree(expanded: Record<string, true>, dir: string): Record<string, true> {
  const prefix = joinPath(dir, "");
  return Object.fromEntries(
    Object.entries(expanded).filter(([key]) => key !== dir && !key.startsWith(prefix)),
  );
}

function treeEntry(
  state: { root: string; children: Record<string, DirEntry[]> },
  path: string,
): DirEntry | undefined {
  const lineage = treeLineage(state.root, path);
  const parent = lineage?.[lineage.length - 2];
  if (parent === undefined) return undefined;
  const name = path.slice(joinPath(parent, "").length);
  return state.children[parent]?.find((entry) => entry.name === name);
}

const listingSeq = new Map<string, number>();

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

export interface TreeClipboard {
  path: string;
  isDir: boolean;
  osChangeCount?: number | null;
}

interface OpenFileState {
  path: string;
  content: FileContent | null;
  loading: boolean;
  error: string | null;
  loadNonce: number;
}

export type SearchMode = "files" | "text";

export interface FilesStore {
  root: string;
  children: Record<string, DirEntry[]>;
  loadingDirs: Record<string, true>;
  dirErrors: Record<string, string>;
  expanded: Record<string, true>;
  repositories: Record<string, RepositorySummary>;
  fileColors: Record<string, Record<string, FileTreeColor>>;
  selectedPath: string | null;
  selectedIsDir: boolean;
  openFiles: string[];
  fileStates: Record<string, OpenFileState>;
  activeFilePath: string | null;
  dirtyPaths: Record<string, true>;
  clipboard: TreeClipboard | null;
  searchRoot: string | null;
  searchMode: SearchMode;
  refreshing: boolean;

  setRoot(path: string): void;
  ensureDir(path: string): Promise<void>;
  toggleDir(path: string): Promise<void>;
  toggleCompactDir(paths: string[]): Promise<void>;
  revealDir(path: string): Promise<void>;
  expandLoadedDirs(): void;
  collapseAllDirs(): void;
  invalidateDir(path: string): Promise<void>;
  refreshTree(): Promise<void>;
  loadGitStatus(levels: Record<string, DirEntry[]>): Promise<void>;
  selectPath(path: string | null, isDir?: boolean): void;
  openFile(path: string): Promise<void>;
  saveFile(path: string, content: string): Promise<string>;
  activateFile(path: string | null): void;
  reloadFile(path: string): Promise<void>;
  closeFile(path: string): void;
  moveOpenFile(path: string, toIndex: number): void;
  setClipboard(item: TreeClipboard | null): void;
  removeTreePath(path: string): void;
  remapTreePath(from: string, to: string): void;
  setFileDirty(path: string, dirty: boolean): void;
  openSearch(searchRoot: string, mode?: SearchMode): void;
  closeSearch(): void;
}

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
    keepShownTree(get());
    const kept = root ? shownTrees.get(root) : undefined;
    const tabs = root ? readTabs(root) : { open: [], active: null };
    set({
      root,
      refreshing: false,
      children: kept?.children ?? {},
      loadingDirs: {},
      dirErrors: {},
      expanded: readExpanded(root),
      repositories: kept?.repositories ?? {},
      fileColors: kept?.fileColors ?? {},
      selectedPath: null,
      selectedIsDir: false,
      openFiles: tabs.open,
      fileStates: Object.fromEntries(tabs.open.map((open) => [open, emptyFile(open)])),
      activeFilePath: tabs.active,
      dirtyPaths: {},
      searchRoot: null,
    });
    if (root) void (kept ? get().refreshTree() : get().ensureDir(root));
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
    } catch {}
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
    const ignored = !!treeEntry(get(), path)?.ignored;
    set((state) => ({
      expanded: { ...state.expanded, ...Object.fromEntries(paths.map((part) => [part, true])) },
    }));
    for (;;) {
      await get().ensureDir(path);
      if (!get().children[path] && !get().dirErrors[path]) await get().ensureDir(path);
      if (generation !== treeGeneration) return;
      const state = get();
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
    } catch {}
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

useFilesStore.subscribe((state, previous) => {
  if (!state.root) return;
  if (state.expanded !== previous.expanded) saveExpanded(state.root, state.expanded);
  if (state.openFiles !== previous.openFiles || state.activeFilePath !== previous.activeFilePath) {
    saveTabs(state.root, state.openFiles, state.activeFilePath);
  }
});
