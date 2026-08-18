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

export interface EditorGroup {
  id: string;
  tabs: OpenTab[];
  activeTabPath: string | null;
}

interface PersistedState {
  rootPath: string | null;
  filesPaneOpen: boolean;
  expandedFolders: string[];
}

interface WorkspaceState extends PersistedState {
  groups: EditorGroup[];
  activeGroupId: string;
  setRootPath: (path: string | null) => void;
  toggleFilesPane: () => void;
  setFilesPaneOpen: (open: boolean) => void;
  toggleFolder: (path: string) => void;

  openTab: (tab: OpenTab, groupId?: string) => void;
  closeTab: (groupId: string, path: string) => void;
  setActiveTab: (groupId: string, path: string) => void;
  updateTabContents: (groupId: string, path: string, contents: string) => void;
  patchTab: (path: string, patch: Partial<OpenTab>) => void;
  markTabSaved: (path: string) => void;

  splitActiveTab: () => void;
  setActiveGroup: (groupId: string) => void;
}

const initialGroupId = "group-primary";

function makeGroup(id: string, tabs: OpenTab[] = []): EditorGroup {
  return {
    id,
    tabs,
    activeTabPath: tabs[tabs.length - 1]?.path ?? null,
  };
}

function updateGroup(
  groups: EditorGroup[],
  groupId: string,
  patch: (group: EditorGroup) => EditorGroup,
): EditorGroup[] {
  return groups.map((group) => (group.id === groupId ? patch(group) : group));
}

export const useCodingWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      rootPath: null,
      filesPaneOpen: true,
      expandedFolders: [],

      groups: [makeGroup(initialGroupId)],
      activeGroupId: initialGroupId,
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

      openTab: (tab, requestedGroupId) =>
        set((state) => {
          const targetGroupId = requestedGroupId ?? state.activeGroupId;
          const groups = state.groups.map((group) => {
            if (group.id !== targetGroupId) return group;
            const existing = group.tabs.find((entry) => entry.path === tab.path);
            if (existing) {
              return { ...group, activeTabPath: tab.path };
            }
            return { ...group, tabs: [...group.tabs, tab], activeTabPath: tab.path };
          });
          return { groups, activeGroupId: targetGroupId };
        }),

      closeTab: (groupId, path) =>
        set((state) => {
          const targetGroup = state.groups.find((group) => group.id === groupId);
          if (!targetGroup) return state;
          const tabs = targetGroup.tabs.filter((tab) => tab.path !== path);
          if (tabs.length === 0 && state.groups.length > 1) {
            const groups = state.groups.filter((group) => group.id !== groupId);
            return {
              groups,
              activeGroupId: groups[0]?.id ?? state.activeGroupId,
            };
          }
          const activeTabPath =
            targetGroup.activeTabPath === path
              ? (tabs[tabs.length - 1]?.path ?? null)
              : targetGroup.activeTabPath;
          return {
            groups: updateGroup(state.groups, groupId, (group) => ({
              ...group,
              tabs,
              activeTabPath,
            })),
          };
        }),

      setActiveTab: (groupId, path) =>
        set((state) => ({
          groups: updateGroup(state.groups, groupId, (group) => ({
            ...group,
            activeTabPath: path,
          })),
          activeGroupId: groupId,
        })),

      updateTabContents: (groupId, path, contents) =>
        set((state) => ({
          groups: updateGroup(state.groups, groupId, (group) => ({
            ...group,
            tabs: group.tabs.map((tab) => (tab.path === path ? { ...tab, contents } : tab)),
          })),
        })),

      patchTab: (path, patch) =>
        set((state) => ({
          groups: state.groups.map((group) => ({
            ...group,
            tabs: group.tabs.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab)),
          })),
        })),

      markTabSaved: (path) =>
        set((state) => ({
          groups: state.groups.map((group) => ({
            ...group,
            tabs: group.tabs.map((tab) =>
              tab.path === path ? { ...tab, savedContents: tab.contents } : tab,
            ),
          })),
        })),

      splitActiveTab: () =>
        set((state) => {
          if (state.groups.length >= 2) return state;
          const activeGroup = state.groups.find((group) => group.id === state.activeGroupId);
          if (!activeGroup?.activeTabPath) return state;
          const activeTab = activeGroup.tabs.find((tab) => tab.path === activeGroup.activeTabPath);
          if (!activeTab) return state;
          const newGroupId = `group-${crypto.randomUUID()}`;
          const duplicate: OpenTab = { ...activeTab };
          return {
            groups: [...state.groups, makeGroup(newGroupId, [duplicate])],
            activeGroupId: newGroupId,
          };
        }),

      setActiveGroup: (groupId) => set({ activeGroupId: groupId }),
    }),
    {
      name: "misty:coding-workspace:v2",
      partialize: (state): PersistedState => ({
        rootPath: state.rootPath,
        filesPaneOpen: state.filesPaneOpen,
        expandedFolders: state.expandedFolders,
      }),
    },
  ),
);

export function useAllOpenTabs(): OpenTab[] {
  const groups = useCodingWorkspaceStore((state) => state.groups);
  return useMemo(() => groups.flatMap((group) => group.tabs), [groups]);
}

export function useDirtyPaths(): Set<string> {
  const dirtyKey = useCodingWorkspaceStore((state) =>
    state.groups
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.contents !== tab.savedContents)
      .map((tab) => tab.path)
      .sort()
      .join("\0"),
  );
  return useMemo(() => new Set(dirtyKey ? dirtyKey.split("\0") : []), [dirtyKey]);
}
