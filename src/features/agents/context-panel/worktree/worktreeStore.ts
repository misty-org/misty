// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { create } from "zustand";
import { useSpaceFolders } from "../../engines/enginesApi";
import { randomBranchSuffix } from "./prInput";
import {
  WORKTREE_PROGRESS_EVENT,
  worktreeApi,
  type WorktreeCreateArgs,
  type WorktreeCreateProgress,
  type WorktreeCreateStage,
  type WorktreeErrorKind,
} from "./worktreeApi";

/** A creation that hasn't finished, or failed: the menu shows it as a row until it's done or
 * dismissed. Its stages come from the native pipeline. */
export interface PendingCreation {
  creationId: string;
  /** The linked folder the worktree is made from. */
  folder: string;
  branch: string;
  stage: WorktreeCreateStage;
  /** The stage's detail, such as `pull/1842/head`. */
  detail?: string;
  errorKind?: WorktreeErrorKind;
  error?: string;
  /** Replayed as they are on a retry, with a new id. */
  args: WorktreeCreateArgs;
  /** Switch the chat's folder to the worktree once it's linked. */
  switchAfter: boolean;
}

interface WorktreePrefs {
  switchAfter: boolean;
}

const PREFS_KEY = "misty.worktreePrefs:v1";

function loadPrefs(): WorktreePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { switchAfter: true };
    const parsed = JSON.parse(raw) as Partial<WorktreePrefs>;
    return { switchAfter: parsed.switchAfter !== false };
  } catch {
    return { switchAfter: true };
  }
}

/** A retry after a name clash: the three-digit suffix is swapped for a new one, or the retry
 * would clash again. Other failures replay as they were. */
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
  /** Counts finished changes, so an open list reads the worktrees again. */
  revision: number;
  /** A note after a removal that worked but left something behind, or an error. */
  notice: string;
  noticeTone: "neutral" | "error";
  start(folder: string, args: WorktreeCreateArgs, opts: { switchAfter: boolean }): string;
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

/** Listens for this window's creation progress, once. */
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
      // A failure of the call itself arrives as a `failed` event too; if none came, the row
      // fails here rather than spinning forever.
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
    prefs: loadPrefs(),
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
        await useSpaceFolders
          .getState()
          .load(space)
          .catch(() => undefined);
      }
    },

    setPrefs: (patch) => {
      const prefs = { ...get().prefs, ...patch };
      set({ prefs });
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        // Without storage the choice only lasts this session.
      }
    },

    applyProgress: (progress) => {
      const target = get().pending.find((p) => p.creationId === progress.creationId);
      if (!target) return;
      if (progress.stage === "done") {
        set((s) => ({
          pending: s.pending.filter((p) => p.creationId !== progress.creationId),
          revision: s.revision + 1,
        }));
        // It is linked now: read the Space's folders again, and switch to it if asked.
        const space = target.args.space;
        void useSpaceFolders
          .getState()
          .load(space)
          .then(() => {
            if (target.switchAfter && progress.path) {
              useSpaceFolders.getState().choose(space, progress.path);
            }
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
