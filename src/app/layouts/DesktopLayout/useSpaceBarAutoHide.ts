import { useBarsAutoHide } from "@/features/app-shell/barsAutoHide";
import { useSettingsStore } from "@/features/settings";
import { stringSetting } from "@/features/settings/SettingsControls";

/** Whether the Space bar tucks away until the pointer reaches the top edge. */
export function useSpaceBarAutoHide(): boolean {
  return useBarsAutoHide();
}

type SpaceBarAlignment = "left" | "center" | "right";

/** Where the Space bar's sections sit along it. */
export function useSpaceBarAlignment(): SpaceBarAlignment {
  const document = useSettingsStore((state) => state.settings?.document);
  const value = stringSetting(document ?? {}, "appearance", "space_bar_alignment", "left");
  return value === "center" || value === "right" ? value : "left";
}
