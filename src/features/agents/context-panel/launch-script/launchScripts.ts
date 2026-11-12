// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { agentAccountId } from "../../personal/agentAccount";
import { readDeviceState, updateDeviceState } from "../folders/deviceState";

/**
 * A folder's start commands. The first is the folder's own start command, run by the play button
 * in the panel's head; the others, with labels, get buttons of their own. They are kept for this
 * device in `misty.db` and never sync.
 */
export interface LaunchScriptEntry {
  id: string;
  /** A name for the button; "" shows the command itself. */
  label: string;
  script: string;
}

interface Stored {
  entries: LaunchScriptEntry[];
}

const scope = (folder: string) => `project-launch:${agentAccountId()}:${folder}`;

function normalize(value: unknown): LaunchScriptEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LaunchScriptEntry>;
  if (typeof candidate.id !== "string" || typeof candidate.script !== "string") return null;
  if (!candidate.script.trim()) return null;
  return {
    id: candidate.id,
    label: typeof candidate.label === "string" ? candidate.label : "",
    script: candidate.script,
  };
}

export function readEntries(stored: unknown): LaunchScriptEntry[] {
  const entries = (stored as Partial<Stored> | null)?.entries;
  return Array.isArray(entries)
    ? entries.map(normalize).filter((entry): entry is LaunchScriptEntry => entry !== null)
    : [];
}

export function createLaunchScriptEntry(label: string, script: string): LaunchScriptEntry {
  return { id: crypto.randomUUID(), label: label.trim(), script: script.trim() };
}

/** Each folder's start commands once read, shared by everything that shows them. */
export const useLaunchScripts = create<{
  byFolder: Record<string, LaunchScriptEntry[]>;
  load(folder: string): Promise<LaunchScriptEntry[]>;
  save(folder: string, entries: LaunchScriptEntry[]): Promise<void>;
}>((set, get) => ({
  byFolder: {},
  async load(folder) {
    const known = get().byFolder[folder];
    if (known) return known;
    const entries = readEntries(await readDeviceState<Stored>(scope(folder)));
    set((state) => ({ byFolder: { ...state.byFolder, [folder]: entries } }));
    return entries;
  },
  async save(folder, entries) {
    const previous = get().byFolder[folder];
    // Shown at once; a failed save puts the old list back.
    set((state) => ({ byFolder: { ...state.byFolder, [folder]: entries } }));
    try {
      await updateDeviceState<Stored>(
        scope(folder),
        () => ({ entries: [] }),
        (current) => ({ ...current, entries }),
      );
    } catch (error) {
      set((state) => ({ byFolder: { ...state.byFolder, [folder]: previous ?? [] } }));
      throw error;
    }
  },
}));
