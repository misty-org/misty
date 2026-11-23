import { createDeviceSetting } from "@/shared/lib/device_setting";

export type SpaceSidebarSection = "channels" | "dms" | "agents";

export const useCollapsedSections = createDeviceSetting<SpaceSidebarSection[]>({
  scope: "sidebar-collapsed-sections",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored)
      ? stored.filter(
          (id): id is SpaceSidebarSection => id === "channels" || id === "dms" || id === "agents",
        )
      : [],
});

export function toggleSection(section: SpaceSidebarSection) {
  useCollapsedSections
    .getState()
    .set((ids) => (ids.includes(section) ? ids.filter((id) => id !== section) : [...ids, section]));
}
