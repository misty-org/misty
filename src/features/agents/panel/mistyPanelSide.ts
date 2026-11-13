import { useSettingsStore } from "@/features/settings";

/** Which edge of the window the side panel sits on. */
export type MistyPanelSide = "left" | "right";

/** The side chosen in settings (Agents › panel side); right by default. */
export function useMistyPanelSide(): MistyPanelSide {
  const agent = useSettingsStore((s) => s.settings?.document.agent) as
    { panel_side?: string } | undefined;
  return agent?.panel_side === "left" ? "left" : "right";
}
