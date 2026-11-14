import { create } from "zustand";

/** One key and value an engine command reports, such as "Model" and "gpt-6.1-sol". */
export interface CommandRow {
  label: string;
  value: string;
}

/** A part of a command's report: an optional heading, rows, then plain or Markdown text. */
export interface CommandSection {
  heading?: string;
  rows?: CommandRow[];
  text?: string;
}

/**
 * What running one of an engine's commands out of turn gives back (`slash/mod.rs`, `Output`):
 * something to show, a message to send instead, a short notice, a Misty surface to open, a new
 * chat on a copied session, or the session's new title.
 */
export type CommandOutput =
  | { kind: "info"; title: string; sections: CommandSection[] }
  | { kind: "send"; text: string }
  | { kind: "done"; notice?: string | null }
  | { kind: "open"; target: string }
  | { kind: "fork"; session: string; title?: string | null; prompt?: string | null }
  | { kind: "rename"; title: string };

export interface CommandReport {
  title: string;
  sections: CommandSection[];
}

/** The command report open over the chat, if any (`CommandReportDialog`). */
export const useCommandReport = create<{
  report?: CommandReport;
  show(report: CommandReport): void;
  close(): void;
}>((set) => ({
  report: undefined,
  show: (report) => set({ report }),
  close: () => set({ report: undefined }),
}));
