import { create } from "zustand";
import type { LspLanguage } from "./languages";
import type { LspInstallStep, LspProgress } from "./lspApi";

/** Where a language's server stands on this computer. */
export type LspInstallPhase = "checking" | "installing" | "ready" | "failed";

export interface LspInstallState {
  phase: LspInstallPhase;
  version?: string;
  error?: string;
  /** While installing: the step, and its bytes when it has them. */
  progress?: { step: LspInstallStep; received: number; total: number | null };
}

/** Where one open file's server stands. */
export type LspFilePhase = "waiting" | "starting" | "ready" | "failed";

export interface LspFileState {
  language: LspLanguage;
  phase: LspFilePhase;
  serverId?: string;
  error?: string;
}

interface LspStore {
  installs: Partial<Record<LspLanguage, LspInstallState>>;
  /** By the file's path, for each editor the language servers serve. */
  files: Record<string, LspFileState>;
  /** By server id: what the server says it is busy with ("Indexing"), if anything. */
  activity: Record<string, string>;
  /** Bumped by Try again, so every editor's server is looked for once more. */
  attempt: number;
  setInstall(language: LspLanguage, state: LspInstallState): void;
  setProgress(progress: LspProgress): void;
  setFile(path: string, state: LspFileState): void;
  clearFile(path: string): void;
  setActivity(serverId: string, title: string | null): void;
  /** A server stopped: the files it served say why. */
  serverClosed(serverId: string, error: string): void;
  retry(): void;
}

/** The language servers' state for the bottom bar. Module-wide: every editor shares it. */
export const useLspStore = create<LspStore>((set) => ({
  installs: {},
  files: {},
  activity: {},
  attempt: 0,

  setInstall: (language, state) =>
    set((current) => ({ installs: { ...current.installs, [language]: state } })),

  setProgress: ({ language, step, received, total }) =>
    set((current) => {
      const install = current.installs[language];
      if (install?.phase !== "installing") return current;
      return {
        installs: {
          ...current.installs,
          [language]: { ...install, progress: { step, received, total } },
        },
      };
    }),

  setFile: (path, state) => set((current) => ({ files: { ...current.files, [path]: state } })),

  clearFile: (path) =>
    set((current) => {
      if (!current.files[path]) return current;
      const { [path]: _gone, ...files } = current.files;
      return { files };
    }),

  setActivity: (serverId, title) =>
    set((current) => {
      if (title) {
        if (current.activity[serverId] === title) return current;
        return { activity: { ...current.activity, [serverId]: title } };
      }
      if (!(serverId in current.activity)) return current;
      const { [serverId]: _done, ...activity } = current.activity;
      return { activity };
    }),

  serverClosed: (serverId, error) =>
    set((current) => {
      const files = { ...current.files };
      let changed = false;
      for (const [path, file] of Object.entries(files)) {
        if (file.serverId !== serverId) continue;
        files[path] = { language: file.language, phase: "failed", error };
        changed = true;
      }
      const { [serverId]: _gone, ...activity } = current.activity;
      return changed ? { files, activity } : { activity };
    }),

  retry: () => set((current) => ({ attempt: current.attempt + 1 })),
}));
