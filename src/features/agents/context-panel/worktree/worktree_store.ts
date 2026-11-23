// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { useChatFolders } from "../../shared-folders/chat_folder";
import { randomBranchSuffix } from "./pr_input";
import {
  WORKTREE_PROGRESS_EVENT,
  worktreeApi,
  type WorktreeCreateArgs,
  type WorktreeCreateProgress,
  type WorktreeCreateStage,
  type WorktreeErrorKind,
} from "./worktree_api";

export interface PendingCreation {
  creationId: string;
  folder: string;
  branch: string;
  stage: WorktreeCreateStage;
  detail?: string;
  errorKind?: WorktreeErrorKind;
  error?: string;
  args: WorktreeCreateArgs;
  switchAfter: boolean;
  conversationId?: string;
}

interface WorktreePrefs {
  switchAfter: boolean;
}

const worktreePrefs = createDeviceSetting<WorktreePrefs>({
  scope: "worktree-prefs",
  defaults: { switchAfter: true },
  normalize: (stored) => ({
    switchAfter: (stored as Partial<WorktreePrefs> | null)?.switchAfter !== false,
  }),
  legacyKey: "misty.worktreePrefs:v1",
});

function renameOnConflict(entry: PendingCreation): PendingCreation {
  const kind = entry.errorKind;
  if (kind !== "branch_exists" && kind !== "dir_exists") return entry;
  const base = entry.args.branch.replace(/-\d{3}$/, "");
  let branch = `${base}-${randomBranchSuffix()}`;
  while (branch === entry.args.branch) branch = `${base}-${randomBranchSuffix()}`;
  return { ...entry, branch, args: { ...entry.args, branch } };
}

interface WorktreeStore {
  pending: PendingCreation[];
  prefs: WorktreePrefs;
  revision: number;
  notice: string;
  noticeTone: "neutral" | "error";
  start(
    folder: string,
    args: WorktreeCreateArgs,
    opts: { switchAfter: boolean; conversationId?: string },
  ): string;
  cancel(creationId: string): void;
  retry(creationId: string): void;
  dismiss(creationId: string): void;
  remove(args: {
    folder: string;
    space: string;
    worktree: string;
    branch: string | null;
    deleteBranch: boolean;
  }): Promise<void>;
  setPrefs(patch: Partial<WorktreePrefs>): void;
  applyProgress(progress: WorktreeCreateProgress): void;
  clearNotice(): void;
}

let eventsReady: Promise<unknown> | null = null;

export function ensureWorktreeEvents(): void {
  eventsReady ??= Promise.resolve()
    .then(() =>
      getCurrentWebview().listen<WorktreeCreateProgress>(WORKTREE_PROGRESS_EVENT, (event) => {
        useWorktreeStore.getState().applyProgress(event.payload);
      }),
    )
    .catch(() => undefined);
}

const newCreationId = () => crypto.randomUUID();

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export const useWorktreeStore = create<WorktreeStore>((set, get) => {
  const launch = (pending: PendingCreation) => {
    ensureWorktreeEvents();
    set((s) => ({ pending: [...s.pending, pending] }));
    void worktreeApi.create(pending.folder, pending.creationId, pending.args).catch(() => {
      const current = get().pending.find((p) => p.creationId === pending.creationId);
      if (current && !["failed", "canceled", "done"].includes(current.stage)) {
        set((s) => ({
          pending: s.pending.map((p) =>
            p.creationId === pending.creationId
              ? { ...p, stage: "failed" as const, errorKind: "unknown" as const }
              : p,
          ),
        }));
      }
    });
  };

  return {
    pending: [],
    prefs: worktreePrefs.getState().value,
    revision: 0,
    notice: "",
    noticeTone: "neutral",

    start: (folder, args, opts) => {
      const creationId = newCreationId();
      launch({
        creationId,
        folder,
        branch: args.branch,
        stage: "validate",
        args,
        switchAfter: opts.switchAfter,
        conversationId: opts.conversationId,
      });
      return creationId;
    },

    cancel: (creationId) => {
      void worktreeApi.cancel(creationId).catch(() => undefined);
    },

    retry: (creationId) => {
      const failed = get().pending.find((p) => p.creationId === creationId);
      if (!failed || (failed.stage !== "failed" && failed.stage !== "canceled")) return;
      set((s) => ({ pending: s.pending.filter((p) => p.creationId !== creationId) }));
      const next = renameOnConflict(failed);
      launch({
        ...next,
        creationId: newCreationId(),
        stage: "validate",
        errorKind: undefined,
        error: undefined,
        detail: undefined,
      });
    },

    dismiss: (creationId) => {
      set((s) => ({ pending: s.pending.filter((p) => p.creationId !== creationId) }));
    },

    remove: async ({ folder, space, worktree, branch, deleteBranch }) => {
      try {
        const result = await worktreeApi.remove(folder, space, worktree, deleteBranch);
        const notes: string[] = [];
        if (result.orphanDirectory)
          notes.push("Git had lost this worktree, so its folder was removed too.");
        if (result.branchKeptReason === "checked_out_elsewhere" && branch) {
          notes.push(`Branch ${branch} is checked out somewhere else, so it was kept.`);
        } else if (result.branchKeptReason === "unknown" && branch) {
          notes.push(`Branch ${branch} couldn't be deleted, so it was kept.`);
        }
        if (notes.length) set({ notice: notes.join(" "), noticeTone: "neutral" });
      } catch (error) {
        set({ notice: errorText(error), noticeTone: "error" });
      } finally {
        set((s) => ({ revision: s.revision + 1 }));
        await useChatFolders
          .getState()
          .loadProjects()
          .catch(() => undefined);
      }
    },

    setPrefs: (patch) => {
      set({ prefs: { ...get().prefs, ...patch } });
      worktreePrefs.getState().set((current) => ({ ...current, ...patch }));
    },

    applyProgress: (progress) => {
      const target = get().pending.find((p) => p.creationId === progress.creationId);
      if (!target) return;
      if (progress.stage === "done") {
        set((s) => ({
          pending: s.pending.filter((p) => p.creationId !== progress.creationId),
          revision: s.revision + 1,
        }));
        const { conversationId } = target;
        void useChatFolders
          .getState()
          .loadProjects()
          .then(async () => {
            if (target.switchAfter && progress.path && conversationId)
              await useChatFolders.getState().use(conversationId, progress.path);
          })
          .catch(() => undefined);
        return;
      }
      set((s) => ({
        pending: s.pending.map((p) =>
          p.creationId === progress.creationId
            ? {
                ...p,
                stage: progress.stage,
                detail: progress.message,
                errorKind: progress.errorKind,
                error: progress.error,
              }
            : p,
        ),
      }));
    },

    clearNotice: () => set({ notice: "" }),
  };
});

worktreePrefs.subscribe(({ value }) => useWorktreeStore.setState({ prefs: value }));
