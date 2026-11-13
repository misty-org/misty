// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { gitApi, gitErrorText, isNotARepo, type BranchInfo, type GitStatus } from "./gitApi";
import { useFilesStore } from "../files/filesStore";

const TTL_MS = 30_000;

/** A file whose diff is shown: staged (index against HEAD) or unstaged and untracked. */
export interface DiffTarget {
  file: string;
  staged: boolean;
}

/** Marks a repository path as not a repository after a NOT_A_REPO answer. */
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
  /** When each repository's status was last read, successfully or not, for the TTL. */
  fetchedAtByWorkspace: Record<string, number>;
  /** The diff open in the panel; null shows the list of changes. */
  diffView: { workspacePath: string; target: DiffTarget } | null;
  openDiff: (workspacePath: string, target: DiffTarget) => void;
  closeDiff: () => void;
  /** Dismisses a repository's refresh error. */
  clearError: (workspacePath: string) => void;

  /** Reads the status again, unless it was read less than 30 seconds ago and `force` is unset. */
  refresh: (workspacePath: string, force?: boolean) => Promise<void>;
  loadBranches: (workspacePath: string) => Promise<void>;

  // Each change reads the status again afterwards. Errors are thrown on so callers show them.
  stage: (workspacePath: string, files: string[]) => Promise<void>;
  unstage: (workspacePath: string, files: string[]) => Promise<void>;
  discard: (workspacePath: string, files: string[]) => Promise<void>;
  commit: (workspacePath: string, message: string) => Promise<string>;
  push: (workspacePath: string) => Promise<void>;
  pull: (workspacePath: string) => Promise<void>;
  checkout: (workspacePath: string, branch: string) => Promise<void>;
  createBranch: (workspacePath: string, name: string) => Promise<void>;
  /** `git init`; resolves once the status has been read out of the not-a-repository state. */
  init: (workspacePath: string) => Promise<void>;
}

/** One status read in flight per repository. */
const inflight = new Map<string, Promise<void>>();

/** The file tree's Git colors and badges go stale after any change; it reads them again. */
function refreshFileTree() {
  // The files store imports this one's diff view; its binding is read only here, at run time.
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
      // The status changed, or may have: drop the TTL and read it again.
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
      // runMutation's refresh isn't awaited; join it (the in-flight map shares it) so the caller
      // stays busy until the panel leaves the not-a-repository state.
      await get().refresh(workspacePath, true);
      // That shared read may have started before the repository existed; its answer is stale.
      if (get().notRepoByWorkspace[workspacePath]) await get().refresh(workspacePath, true);
    },
  };
});
