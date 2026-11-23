import { useEffect } from "react";
import { create } from "zustand";
import { listEngines, mistyEngine } from "./engines_api";

export type EngineModeKind = "asks" | "edits" | "plans" | "no_asking";

export interface EngineModeOption {
  id: string;
  label: string;
  kind: EngineModeKind;
}

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

export function useEngineModes(engine: string | undefined): EngineModeOption[] {
  const misty = isMisty(engine);
  const modes = useEngineModeStore((s) => (misty ? mistyModes : s.byEngine[engine ?? ""]));
  useEffect(() => {
    if (!misty) void useEngineModeStore.getState().load();
  }, [misty]);
  return modes ?? [];
}

export async function engineModesFor(engine: string | undefined) {
  if (isMisty(engine)) return mistyModes;
  await useEngineModeStore.getState().load();
  return useEngineModeStore.getState().byEngine[engine ?? ""] ?? [];
}

function legacyKind(value: string): EngineModeKind | undefined {
  if (value === "ask" || value === "manual") return "asks";
  if (value === "auto") return "edits";
  if (value === "plan") return "plans";
  if (value === "bypass") return "no_asking";
  return undefined;
}

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
