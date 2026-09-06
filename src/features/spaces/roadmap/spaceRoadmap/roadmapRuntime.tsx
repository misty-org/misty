import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { MistyAppCommand, MistySurfaceAdapter } from "@misty/sdk";
import type { PlannerTaskServices } from "../../planner/spaceTasks/taskServices";
import type { PlannerRoadmapServices } from "./roadmapServices";

export type PlannerPreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export interface RoadmapRuntime {
  api: PlannerRoadmapServices & PlannerTaskServices;
  userId?: string;
  focused: boolean;
  theme: "light" | "dark";
  storage: PlannerPreferenceStorage;
  shortcutLabels: Readonly<Record<string, string>>;
  registerCommand(
    command: MistyAppCommand,
    listener: () => void,
    enabled: () => boolean,
  ): () => void;
  subscribeChanges(listener: () => void): () => void;
  renderIntegration(input: { title: string; adapter: MistySurfaceAdapter | null }): ReactNode;
  renderError(message: string): ReactNode;
}
const Context = createContext<RoadmapRuntime | null>(null);
export function RoadmapRuntimeProvider({
  runtime,
  children,
}: {
  runtime: RoadmapRuntime;
  children: ReactNode;
}) {
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function useRoadmapRuntime() {
  const value = useContext(Context);
  if (!value) throw new Error("Roadmaps requires an App runtime.");
  return value;
}
export function useRoadmapCommand(
  command: MistyAppCommand,
  listener: () => void,
  enabled: boolean | (() => boolean) = true,
) {
  const { registerCommand, focused } = useRoadmapRuntime();
  const current = useRef({ listener, enabled, focused });
  current.current = { listener, enabled, focused };
  useEffect(() => {
    const active = () =>
      current.current.focused &&
      (typeof current.current.enabled === "function"
        ? current.current.enabled()
        : current.current.enabled);
    return registerCommand(
      command,
      () => {
        if (active()) current.current.listener();
      },
      active,
    );
  }, [command, registerCommand]);
}
export function useRoadmapShortcutTitle(label: string, command: MistyAppCommand) {
  const shortcut = useRoadmapRuntime().shortcutLabels[command];
  return shortcut ? `${label} (${shortcut})` : label;
}
export function isPlannerConflict(reason: unknown) {
  return Boolean(
    reason &&
    typeof reason === "object" &&
    (("code" in reason && reason.code === "version_conflict") ||
      ("status" in reason && reason.status === 409)),
  );
}
