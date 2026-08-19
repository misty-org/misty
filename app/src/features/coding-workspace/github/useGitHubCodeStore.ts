import {
  githubCodeApi,
  type GitHubCodeWorkspace,
  type GitHubInstallation,
  type GitHubRepository,
  type GitHubRepositoryRecord,
} from "@/api/integrations/github";
import { create } from "zustand";

interface GitHubCodeState {
  scopeKey: string;
  installations: GitHubInstallation[];
  workspaces: GitHubCodeWorkspace[];
  repositoriesByInstallation: Record<string, GitHubRepository[]>;
  recordsByWorkspace: Record<string, GitHubRepositoryRecord[]>;
  loading: boolean;
  busy: string;
  error: string;
  load: (accountId: string, spaceId: string) => Promise<void>;
  discover: (spaceId: string, installationId: string) => Promise<void>;
  bind: (
    spaceId: string,
    installationId: string,
    repositoryId: number,
    clientWorkspaceId: string,
  ) => Promise<GitHubCodeWorkspace>;
  sync: (spaceId: string, workspaceId: string) => Promise<void>;
  loadRecords: (spaceId: string, workspaceId: string) => Promise<void>;
  disconnect: (spaceId: string, installationId: string) => Promise<void>;
  unlink: (spaceId: string, workspaceId: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const emptyState = {
  scopeKey: "",
  installations: [],
  workspaces: [],
  repositoriesByInstallation: {},
  recordsByWorkspace: {},
  loading: false,
  busy: "",
  error: "",
};

export const useGitHubCodeStore = create<GitHubCodeState>((set, get) => ({
  ...emptyState,

  load: async (accountId, spaceId) => {
    const scopeKey = `${accountId}:${spaceId}`;
    set({
      ...emptyState,
      scopeKey,
      loading: true,
    });
    try {
      const [installationResult, workspaceResult] = await Promise.all([
        githubCodeApi.installations(spaceId),
        githubCodeApi.workspaces(spaceId),
      ]);
      if (get().scopeKey !== scopeKey) return;
      set({
        installations: installationResult.installations,
        workspaces: workspaceResult.workspaces,
        loading: false,
      });
      const recordResults = await Promise.allSettled(
        workspaceResult.workspaces.map(async (workspace) => ({
          workspaceId: workspace.id,
          records: (await githubCodeApi.records(spaceId, workspace.id)).records,
        })),
      );
      if (get().scopeKey !== scopeKey) return;
      set({
        recordsByWorkspace: Object.fromEntries(
          recordResults.flatMap((result) =>
            result.status === "fulfilled"
              ? [[result.value.workspaceId, result.value.records] as const]
              : [],
          ),
        ),
      });
    } catch (error) {
      if (get().scopeKey !== scopeKey) return;
      set({ loading: false, error: errorMessage(error, "GitHub could not be loaded.") });
    }
  },

  discover: async (spaceId, installationId) => {
    set({ busy: `discover:${installationId}`, error: "" });
    try {
      const result = await githubCodeApi.repositories(spaceId, installationId);
      set((state) => ({
        repositoriesByInstallation: {
          ...state.repositoriesByInstallation,
          [installationId]: result.repositories,
        },
        busy: "",
      }));
    } catch (error) {
      set({ busy: "", error: errorMessage(error, "GitHub repositories could not be listed.") });
    }
  },

  bind: async (spaceId, installationId, repositoryId, clientWorkspaceId) => {
    set({ busy: "bind", error: "" });
    try {
      const result = await githubCodeApi.bindWorkspace(
        spaceId,
        installationId,
        repositoryId,
        clientWorkspaceId,
      );
      set((state) => ({
        workspaces: replaceById(state.workspaces, result.workspace),
        busy: "",
      }));
      return result.workspace;
    } catch (error) {
      set({ busy: "", error: errorMessage(error, "That repository could not be linked.") });
      throw error;
    }
  },

  sync: async (spaceId, workspaceId) => {
    set({ busy: `sync:${workspaceId}`, error: "" });
    try {
      const result = await githubCodeApi.syncWorkspace(spaceId, workspaceId);
      set((state) => ({
        workspaces: replaceById(state.workspaces, result.workspace),
        busy: "",
      }));
      await get().loadRecords(spaceId, workspaceId);
    } catch (error) {
      set({ busy: "", error: errorMessage(error, "GitHub provenance could not be refreshed.") });
    }
  },

  loadRecords: async (spaceId, workspaceId) => {
    try {
      const result = await githubCodeApi.records(spaceId, workspaceId);
      set((state) => ({
        recordsByWorkspace: { ...state.recordsByWorkspace, [workspaceId]: result.records },
      }));
    } catch (error) {
      set({ error: errorMessage(error, "GitHub provenance could not be loaded.") });
    }
  },

  disconnect: async (spaceId, installationId) => {
    set({ busy: `disconnect:${installationId}`, error: "" });
    try {
      await githubCodeApi.disconnect(spaceId, installationId);
      set((state) => ({
        installations: state.installations.filter((item) => item.id !== installationId),
        workspaces: state.workspaces.filter((item) => item.installation_id !== installationId),
        busy: "",
      }));
    } catch (error) {
      set({ busy: "", error: errorMessage(error, "GitHub could not be disconnected.") });
    }
  },

  unlink: async (spaceId, workspaceId) => {
    set({ busy: `unlink:${workspaceId}`, error: "" });
    try {
      await githubCodeApi.unlinkWorkspace(spaceId, workspaceId);
      set((state) => ({
        workspaces: state.workspaces.filter((item) => item.id !== workspaceId),
        busy: "",
      }));
    } catch (error) {
      set({ busy: "", error: errorMessage(error, "The repository link could not be removed.") });
    }
  },

  clearError: () => set({ error: "" }),
  reset: () => set(emptyState),
}));

function replaceById<T extends { id: string }>(items: T[], next: T): T[] {
  return items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
