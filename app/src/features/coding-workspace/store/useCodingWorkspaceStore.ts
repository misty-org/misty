import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LineEnding } from "../native";

export interface OpenTab {
  path: string;
  name: string;
  contents: string;
  savedContents: string;
  lineEnding: LineEnding;
  readonly: boolean;
  loading: boolean;
  error: string | null;
}

export interface ProjectState {
  expandedFolders: string[];
  marks: string[];
  recents: string[];
}

export interface CodeViewport {
  rootPath: string;
  activeFilePath: string | null;
}

interface PersistedState {
  /** Legacy fields retained so v2 installs can migrate their first Code tab. */
  rootPath: string | null;
  filesPaneOpen: boolean;
  expandedFolders: string[];
  projects: Record<string, ProjectState>;
}

interface WorkspaceState extends PersistedState {
  projectBuffers: Record<string, Record<string, OpenTab>>;
  views: Record<string, CodeViewport>;
  ensureView: (viewId: string, rootPath?: string | null) => void;
  clearView: (viewId: string) => void;
  setRootPath: (path: string | null) => void;
  toggleFilesPane: () => void;
  setFilesPaneOpen: (open: boolean) => void;
  toggleFolder: (path: string) => void;
  openFile: (rootPath: string, viewId: string, buffer: OpenTab) => void;
  setActiveFile: (rootPath: string, viewId: string, path: string) => void;
  removeBuffer: (rootPath: string, path: string) => void;
  updateBufferContents: (rootPath: string, path: string, contents: string) => void;
  patchBuffer: (rootPath: string, path: string, patch: Partial<OpenTab>) => void;
  markBufferSaved: (rootPath: string, path: string) => void;
  toggleProjectFolder: (rootPath: string, path: string) => void;
  toggleMark: (rootPath: string, path: string) => void;
  moveMark: (rootPath: string, path: string, direction: -1 | 1) => void;
  recordRecent: (rootPath: string, path: string) => void;
}

export const useCodingWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      rootPath: null,
      filesPaneOpen: true,
      expandedFolders: [],
      projects: {},
      projectBuffers: {},
      views: {},

      ensureView: (viewId, rootPath) =>
        set((state) =>
          state.views[viewId]
            ? state
            : {
                views: {
                  ...state.views,
                  [viewId]: { rootPath: rootPath ?? "", activeFilePath: null },
                },
              },
        ),

      clearView: (viewId) =>
        set((state) => {
          const current = state.views[viewId];
          if (!current) return state;
          return {
            views: { ...state.views, [viewId]: { ...current, activeFilePath: null } },
          };
        }),

      setRootPath: (path) => set({ rootPath: path, expandedFolders: path ? [path] : [] }),
      toggleFilesPane: () => set((state) => ({ filesPaneOpen: !state.filesPaneOpen })),
      setFilesPaneOpen: (open) => set({ filesPaneOpen: open }),
      toggleFolder: (path) =>
        set((state) => {
          const next = new Set(state.expandedFolders);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return { expandedFolders: [...next] };
        }),

      openFile: (rootPath, viewId, buffer) =>
        set((state) => {
          const buffers = state.projectBuffers[rootPath] ?? {};
          return {
            projectBuffers: {
              ...state.projectBuffers,
              [rootPath]: buffers[buffer.path] ? buffers : { ...buffers, [buffer.path]: buffer },
            },
            views: {
              ...state.views,
              [viewId]: { rootPath, activeFilePath: buffer.path },
            },
          };
        }),

      setActiveFile: (rootPath, viewId, path) =>
        set((state) =>
          state.projectBuffers[rootPath]?.[path]
            ? {
                views: {
                  ...state.views,
                  [viewId]: { rootPath, activeFilePath: path },
                },
              }
            : state,
        ),

      removeBuffer: (rootPath, path) =>
        set((state) => {
          const buffers = state.projectBuffers[rootPath];
          if (!buffers?.[path]) return state;
          const { [path]: _removed, ...remaining } = buffers;
          return {
            projectBuffers: { ...state.projectBuffers, [rootPath]: remaining },
            views: Object.fromEntries(
              Object.entries(state.views).map(([id, view]) => [
                id,
                view.rootPath === rootPath && view.activeFilePath === path
                  ? { ...view, activeFilePath: null }
                  : view,
              ]),
            ),
          };
        }),

      updateBufferContents: (rootPath, path, contents) =>
        set((state) => patchProjectBuffer(state, rootPath, path, { contents })),

      patchBuffer: (rootPath, path, patch) =>
        set((state) => patchProjectBuffer(state, rootPath, path, patch)),

      markBufferSaved: (rootPath, path) =>
        set((state) => {
          const buffer = state.projectBuffers[rootPath]?.[path];
          return buffer
            ? patchProjectBuffer(state, rootPath, path, { savedContents: buffer.contents })
            : state;
        }),

      toggleProjectFolder: (rootPath, path) =>
        set((state) => {
          const project = projectState(state.projects[rootPath]);
          const expanded = new Set(project.expandedFolders);
          if (expanded.has(path)) expanded.delete(path);
          else expanded.add(path);
          return {
            projects: {
              ...state.projects,
              [rootPath]: { ...project, expandedFolders: [...expanded] },
            },
          };
        }),

      toggleMark: (rootPath, path) =>
        set((state) => {
          const project = projectState(state.projects[rootPath]);
          const marks = project.marks.includes(path)
            ? project.marks.filter((entry) => entry !== path)
            : [...project.marks, path];
          return { projects: { ...state.projects, [rootPath]: { ...project, marks } } };
        }),

      moveMark: (rootPath, path, direction) =>
        set((state) => {
          const project = projectState(state.projects[rootPath]);
          const index = project.marks.indexOf(path);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= project.marks.length) return state;
          const marks = [...project.marks];
          const [mark] = marks.splice(index, 1);
          if (!mark) return state;
          marks.splice(target, 0, mark);
          return { projects: { ...state.projects, [rootPath]: { ...project, marks } } };
        }),

      recordRecent: (rootPath, path) =>
        set((state) => {
          const project = projectState(state.projects[rootPath]);
          const recents = [path, ...project.recents.filter((entry) => entry !== path)].slice(0, 50);
          return { projects: { ...state.projects, [rootPath]: { ...project, recents } } };
        }),
    }),
    {
      name: "misty:coding-workspace:v2",
      partialize: (state): PersistedState => ({
        rootPath: state.rootPath,
        filesPaneOpen: state.filesPaneOpen,
        expandedFolders: state.expandedFolders,
        projects: state.projects,
      }),
    },
  ),
);

function patchProjectBuffer(
  state: WorkspaceState,
  rootPath: string,
  path: string,
  patch: Partial<OpenTab>,
): WorkspaceState | Partial<WorkspaceState> {
  const buffers = state.projectBuffers[rootPath];
  const buffer = buffers?.[path];
  if (!buffers || !buffer) return state;
  return {
    projectBuffers: {
      ...state.projectBuffers,
      [rootPath]: { ...buffers, [path]: { ...buffer, ...patch } },
    },
  };
}

const EMPTY_PROJECT_STATE: ProjectState = Object.freeze({
  expandedFolders: [],
  marks: [],
  recents: [],
});

export function projectState(value: ProjectState | undefined): ProjectState {
  return value ?? EMPTY_PROJECT_STATE;
}

export function useAllOpenTabs(): OpenTab[] {
  const projectBuffers = useCodingWorkspaceStore((state) => state.projectBuffers);
  return useMemo(
    () => Object.values(projectBuffers).flatMap((buffers) => Object.values(buffers)),
    [projectBuffers],
  );
}

export function useDirtyPaths(): Set<string> {
  const projectBuffers = useCodingWorkspaceStore((state) => state.projectBuffers);
  return useMemo(
    () =>
      new Set(
        Object.values(projectBuffers)
          .flatMap((buffers) => Object.values(buffers))
          .filter((buffer) => buffer.contents !== buffer.savedContents)
          .map((buffer) => buffer.path),
      ),
    [projectBuffers],
  );
}
