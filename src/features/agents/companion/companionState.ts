import { create } from "zustand";
import type { CompanionMode, Presentation } from "./protocol";
export type CompanionControl =
  | { kind: "size"; size: number }
  | { kind: "visibility"; visible: boolean }
  | { kind: "mode"; mode: CompanionMode }
  | { kind: "model"; model: string }
  | { kind: "stop" }
  | { kind: "retry" };
export const initialCompanionPresentation: Presentation = {
  generation: 0,
  phase: "idle",
  visible: false,
  showCompanion: true,
  size: 100,
  enabled: false,
  mode: "team",
  model: "",
};
interface CompanionState {
  accountId: string;
  presentation: Presentation;
  control?: (control: CompanionControl) => Promise<void>;
}
/** Main-window bridge: the Agents page and native voice share one controller and mode. */
export const useCompanionState = create<CompanionState>(() => ({
  accountId: "",
  presentation: initialCompanionPresentation,
}));
export async function companionControl(control: CompanionControl) {
  const handler = useCompanionState.getState().control;
  if (!handler) throw new Error("The companion is starting. Try again in a moment.");
  await handler(control);
}
