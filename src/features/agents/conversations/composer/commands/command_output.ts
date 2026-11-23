import { create } from "zustand";

export interface CommandRow {
  label: string;
  value: string;
}

export interface CommandSection {
  heading?: string;
  rows?: CommandRow[];
  text?: string;
}

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

export const useCommandReport = create<{
  report?: CommandReport;
  show(report: CommandReport): void;
  close(): void;
}>((set) => ({
  report: undefined,
  show: (report) => set({ report }),
  close: () => set({ report: undefined }),
}));
