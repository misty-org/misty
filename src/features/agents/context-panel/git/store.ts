// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { gitApi, gitErrorText, isNotARepo, type BranchInfo, type GitStatus } from "./git_api";
import { useFilesStore } from "../files/files_store";

const TTL_MS = 30_000;

export interface DiffTarget {
  file: string;
  staged: boolean;
}

function notRepoPatch(repository: string) {
  return (state: GitStore) => ({
    notRepoByWorkspace: { ...state.notRepoByWorkspace, [repository]: true },
    statusByWorkspace: { ...state.statusByWorkspace, [repository]: undefined },
  });
}

interface GitStore {
  statusByWorkspace: Record<string, GitStatus | undefined>;
  notRepoByWorkspace: Record<string, boolean>;
  errorByWorkspace: Record<string, string | null>;
  branchesByWorkspace: Record<string, BranchInfo[] | undefined>;
  fetchedAtByWorkspace: Record<string, number>;
  diffView: { workspacePath: string; target: DiffTarget } | null;
  openDiff: (workspacePath: string, target: DiffTarget) => void;
  closeDiff: () => void;
  clearError: (workspacePath: string) => void;

  refresh: (workspacePath: string, force?: boolean) => Promise<void>;
  loadBranches: (workspacePath: string) => Promise<void>;

  stage: (workspacePath: string, files: string[]) => Promise<void>;
  unstage: (workspacePath: string, files: string[]) => Promise<void>;
  discard: (workspacePath: string, files: string[]) => Promise<void>;
  commit: (workspacePath: string, message: string) => Promise<string>;
  push: (workspacePath: string) => Promise<void>;
  pull: (workspacePath: string) => Promise<void>;
  checkout: (workspacePath: string, branch: string) => Promise<void>;
  createBranch: (workspacePath: string, name: string) => Promise<void>;
  init: (workspacePath: string) => Promise<void>;
}

const inflight = new Map<string, Promise<void>>();

function refreshFileTree() {
  void useFilesStore
    .getState()
    .refreshTree()
    .catch(() => undefined);
}

export const useGitStore = create<GitStore>((set, get) => {
  const runMutation = async <T>(workspacePath: string, action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (isNotARepo(error)) set(notRepoPatch(workspacePath));
      throw new Error(gitErrorText(error));
    } finally {
      set((state) => ({
        fetchedAtByWorkspace: { ...state.fetchedAtByWorkspace, [workspacePath]: 0 },
      }));
      get()
        .refresh(workspacePath, true)
        .catch(() => undefined);
      refreshFileTree();
    }
  };

  return {
    statusByWorkspace: {},
    notRepoByWorkspace: {},
    errorByWorkspace: {},
    branchesByWorkspace: {},
    fetchedAtByWorkspace: {},
    diffView: null,

    openDiff: (workspacePath, target) => set({ diffView: { workspacePath, target } }),
    closeDiff: () => set({ diffView: null }),
    clearError: (workspacePath) =>
      set((state) => ({
        errorByWorkspace: { ...state.errorByWorkspace, [workspacePath]: null },
      })),

    refresh: (workspacePath, force = false) => {
      const last = get().fetchedAtByWorkspace[workspacePath];
      if (!force && last && Date.now() - last < TTL_MS) return Promise.resolve();
      const pending = inflight.get(workspacePath);
      if (pending) return pending;

      const task = gitApi
        .status(workspacePath)
        .then((status) => {
          set((state) => ({
            statusByWorkspace: { ...state.statusByWorkspace, [workspacePath]: status },
            notRepoByWorkspace: { ...state.notRepoByWorkspace, [workspacePath]: false },
            errorByWorkspace: { ...state.errorByWorkspace, [workspacePath]: null },
            fetchedAtByWorkspace: { ...state.fetchedAtByWorkspace, [workspacePath]: Date.now() },
          }));
        })
        .catch((error: unknown) => {
          const notRepo = isNotARepo(error);
          set((state) => ({
            statusByWorkspace: { ...state.statusByWorkspace, [workspacePath]: undefined },
            notRepoByWorkspace: { ...state.notRepoByWorkspace, [workspacePath]: notRepo },
            errorByWorkspace: {
              ...state.errorByWorkspace,
              [workspacePath]: notRepo ? null : gitErrorText(error),
            },
            fetchedAtByWorkspace: { ...state.fetchedAtByWorkspace, [workspacePath]: Date.now() },
          }));
        })
        .finally(() => {
          inflight.delete(workspacePath);
        });
      inflight.set(workspacePath, task);
      return task;
    },

    loadBranches: async (workspacePath) => {
      if (get().notRepoByWorkspace[workspacePath]) return;
      try {
        const branches = await gitApi.branches(workspacePath);
        set((state) => ({
          branchesByWorkspace: { ...state.branchesByWorkspace, [workspacePath]: branches },
        }));
      } catch (error) {
        if (isNotARepo(error)) set(notRepoPatch(workspacePath));
      }
    },

    stage: (workspacePath, files) =>
      runMutation(workspacePath, () => gitApi.stage(workspacePath, files)),
    unstage: (workspacePath, files) =>
      runMutation(workspacePath, () => gitApi.unstage(workspacePath, files)),
    discard: (workspacePath, files) =>
      runMutation(workspacePath, () => gitApi.discard(workspacePath, files)),
    commit: (workspacePath, message) =>
      runMutation(workspacePath, () => gitApi.commit(workspacePath, message)),
    push: (workspacePath) => runMutation(workspacePath, () => gitApi.push(workspacePath)),
    pull: (workspacePath) => runMutation(workspacePath, () => gitApi.pull(workspacePath)),
    checkout: async (workspacePath, branch) => {
      await runMutation(workspacePath, () => gitApi.checkout(workspacePath, branch));
      await get().loadBranches(workspacePath);
    },
    createBranch: async (workspacePath, name) => {
      await runMutation(workspacePath, () => gitApi.createBranch(workspacePath, name));
      await get().loadBranches(workspacePath);
    },
    init: async (workspacePath) => {
      await runMutation(workspacePath, () => gitApi.init(workspacePath));
      await get().refresh(workspacePath, true);
      if (get().notRepoByWorkspace[workspacePath]) await get().refresh(workspacePath, true);
    },
  };
});
