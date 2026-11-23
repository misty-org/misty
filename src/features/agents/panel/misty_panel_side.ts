import { useSettingsStore } from "@/features/settings";

export type MistyPanelSide = "left" | "right";

export function useMistyPanelSide(): MistyPanelSide {
  const agent = useSettingsStore((s) => s.settings?.document.agent) as
    { panel_side?: string } | undefined;
  return agent?.panel_side === "left" ? "left" : "right";
}
