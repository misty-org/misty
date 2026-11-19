import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

/** Who changed a file under the editor: an agent's run, or something else on disk. */
export type ReviewSource = "agent" | "disk";

/** A file being reviewed: what it held before the change, and what changed it. */
export interface FileReview {
  before: string;
  source: ReviewSource;
}

/**
 * The Code page's Git state per open file: its text at the last commit (for change marks), an
 * agent's or the disk's change waiting for review, and whether the comparison with the last commit
 * is shown inline. Every key is a file's absolute path.
 */
export const useGitReview = create<{
  /** `null` once read: not in a repository, not committed yet, or not text. */
  head: Record<string, string | null>;
  reviews: Record<string, FileReview>;
  /** Files whose changes since the last commit are shown inline, with accept and undo. */
  comparing: Record<string, boolean>;
  /** A change on disk to a file with unsaved edits, which isn't put in front of them unasked. */
  clashes: Record<string, string>;
  /** How many changes each file's inline view still shows, for the review bar. */
  counts: Record<string, number>;
  setCount(path: string, count: number): void;
  loadHead(path: string): Promise<void>;
  startReview(path: string, review: FileReview): void;
  endReview(path: string): void;
  setComparing(path: string, on: boolean): void;
  setClash(path: string, diskText: string | null): void;
}>((set, get) => ({
  head: {},
  reviews: {},
  comparing: {},
  clashes: {},
  counts: {},
  setCount(path, count) {
    if (get().counts[path] !== count) set({ counts: { ...get().counts, [path]: count } });
  },
  async loadHead(path) {
    try {
      const text = await invoke<string | null>("code_git_head_text", {
        account: agentAccountId(),
        path,
      });
      if (get().head[path] !== text) set({ head: { ...get().head, [path]: text } });
    } catch {
      // Outside a linked folder or gone: no change marks.
      if (get().head[path] !== null) set({ head: { ...get().head, [path]: null } });
    }
  },
  startReview(path, review) {
    set({
      reviews: { ...get().reviews, [path]: review },
      comparing: { ...get().comparing, [path]: false },
    });
  },
  endReview(path) {
    if (!(path in get().reviews)) return;
    const { [path]: _done, ...rest } = get().reviews;
    set({ reviews: rest });
  },
  setComparing(path, on) {
    set({ comparing: { ...get().comparing, [path]: on } });
  },
  setClash(path, diskText) {
    if (diskText === null) {
      if (!(path in get().clashes)) return;
      const { [path]: _gone, ...rest } = get().clashes;
      set({ clashes: rest });
    } else set({ clashes: { ...get().clashes, [path]: diskText } });
  },
}));

/** The editor showing each file on the Code page, for the review bar's whole-file actions. */
export const reviewViews = new Map<string, EditorView>();
