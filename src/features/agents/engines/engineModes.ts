import { useEffect } from "react";
import { create } from "zustand";
import { listEngines, mistyEngine } from "./enginesApi";

/**
 * Each engine's own modes, as native code lists them (`engines_list`, `engines/modes.rs`): the
 * engine's own id and name, and the fixed kind Misty's gate reads. Misty has no modes of its own;
 * native code checks the chosen id against the engine's list and decides what it passes.
 */
export type EngineModeKind = "asks" | "edits" | "plans" | "no_asking";

export interface EngineModeOption {
  id: string;
  label: string;
  kind: EngineModeKind;
}

/** Misty's own runtime, read the same way (`MISTY_MODES` in `engines/modes.rs`). */
const mistyModes: EngineModeOption[] = [
  { id: "ask", label: "Ask", kind: "asks" },
  { id: "auto", label: "Auto", kind: "edits" },
  { id: "plan", label: "Plan", kind: "plans" },
];

interface EngineModesStore {
  byEngine: Record<string, EngineModeOption[]>;
  loaded: boolean;
  load(): Promise<void>;
}

let pending: Promise<void> | null = null;

export const useEngineModeStore = create<EngineModesStore>((set) => ({
  byEngine: {},
  loaded: false,
  load() {
    pending ??= listEngines()
      .then((engines) => {
        const byEngine: Record<string, EngineModeOption[]> = {};
        for (const engine of engines) byEngine[engine.id] = engine.modes ?? [];
        set({ byEngine, loaded: true });
      })
      .catch(() => {
        pending = null;
      });
    return pending;
  },
}));

const isMisty = (engine: string | undefined) => !engine || engine === mistyEngine;

/** The modes an engine offers on this computer; Misty's own runtime's for none. */
export function useEngineModes(engine: string | undefined): EngineModeOption[] {
  const misty = isMisty(engine);
  const modes = useEngineModeStore((s) => (misty ? mistyModes : s.byEngine[engine ?? ""]));
  useEffect(() => {
    if (!misty) void useEngineModeStore.getState().load();
  }, [misty]);
  return modes ?? [];
}

/** The same list, once native code has answered. */
export async function engineModesFor(engine: string | undefined) {
  if (isMisty(engine)) return mistyModes;
  await useEngineModeStore.getState().load();
  return useEngineModeStore.getState().byEngine[engine ?? ""] ?? [];
}

/** What a choice saved before engines had their own modes (Ask, Auto, Plan, Bypass) stood for. */
function legacyKind(value: string): EngineModeKind | undefined {
  if (value === "ask" || value === "manual") return "asks";
  if (value === "auto") return "edits";
  if (value === "plan") return "plans";
  if (value === "bypass") return "no_asking";
  return undefined;
}

/** The engine's mode of a kind, or the closest one that asks no less (as native code reads it). */
function closest(modes: EngineModeOption[], kind: EngineModeKind) {
  const order: Record<EngineModeKind, EngineModeKind[]> = {
    no_asking: ["no_asking", "edits", "asks"],
    edits: ["edits", "asks"],
    plans: ["plans", "asks"],
    asks: ["asks"],
  };
  for (const wanted of order[kind]) {
    const found = modes.find((mode) => mode.kind === wanted);
    if (found) return found;
  }
  return modes[0];
}

/**
 * The mode a chat runs in: a saved engine mode id, or an older saved choice mapped to the
 * engine's own mode once, as it is read. A chat that is planning (`/plan`, or the planning
 * default for new chats) takes the engine's planning mode.
 */
export function resolveEngineMode(
  modes: EngineModeOption[],
  saved: string | undefined,
  planning = false,
): EngineModeOption | undefined {
  if (!modes.length) return undefined;
  if (planning) {
    const plan = modes.find((mode) => mode.kind === "plans");
    if (plan) return plan;
  }
  const value = saved?.trim() ?? "";
  const named = modes.find((mode) => mode.id === value);
  if (named) return named;
  return closest(modes, legacyKind(value) ?? "asks");
}
