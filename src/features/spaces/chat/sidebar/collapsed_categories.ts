import { createDeviceSetting } from "@/shared/lib/device_setting";

export const useCollapsedCategories = createDeviceSetting<string[]>({
  scope: "sidebar-collapsed-categories",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [],
});

export function toggleCategory(categoryId: string) {
  useCollapsedCategories
    .getState()
    .set((ids) =>
      ids.includes(categoryId) ? ids.filter((id) => id !== categoryId) : [...ids, categoryId],
    );
}
