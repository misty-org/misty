import { useSettingsStore } from "@/features/settings";
import type { MistyPanelSide } from "./MistyPanel";

/** The side chosen in settings (Agents › panel side); right by default. */
export function useMistyPanelSide(): MistyPanelSide {
  const agent = useSettingsStore((s) => s.settings?.document.agent) as
    { panel_side?: string } | undefined;
  return agent?.panel_side === "left" ? "left" : "right";
}
