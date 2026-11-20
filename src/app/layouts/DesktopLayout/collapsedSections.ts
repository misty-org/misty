import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** The Space sidebar's conversation sections that can be folded away. */
export type SpaceSidebarSection = "channels" | "dms";

/**
 * The sections the person has folded away (Channels, Direct messages). Every section starts open;
 * the choice stays on this device in `misty.db`.
 */
export const useCollapsedSections = createDeviceSetting<SpaceSidebarSection[]>({
  scope: "sidebar-collapsed-sections",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored)
      ? stored.filter(
          (id): id is SpaceSidebarSection => id === "channels" || id === "dms",
        )
      : [],
});

/** Folds a section away, or opens it again. */
export function toggleSection(section: SpaceSidebarSection) {
  useCollapsedSections
    .getState()
    .set((ids) => (ids.includes(section) ? ids.filter((id) => id !== section) : [...ids, section]));
}
