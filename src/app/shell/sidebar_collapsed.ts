import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";

const savedCollapsed = createDeviceSetting<boolean>({
  scope: "sidebar-collapsed",
  defaults: false,
  normalize: (stored) => stored === true || stored === "true",
  legacyKey: "misty:sidebar-collapsed:v1",
});

export const useSidebarCollapsedStore = create<{ collapsed: boolean; toggle(): void }>(
  (set, get) => ({
    collapsed: savedCollapsed.getState().value,
    toggle: () => {
      const collapsed = !get().collapsed;
      restored = true;
      set({ collapsed });
      savedCollapsed.getState().set(collapsed);
    },
  }),
);

let restored = false;
savedCollapsed.subscribe(({ value, loaded }) => {
  if (!loaded || restored) return;
  restored = true;
  useSidebarCollapsedStore.setState({ collapsed: value });
});
