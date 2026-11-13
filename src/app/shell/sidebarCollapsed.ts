import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** Kept for this device in `misty.db`; older builds kept it in the webview's storage. */
const savedCollapsed = createDeviceSetting<boolean>({
  scope: "sidebar-collapsed",
  defaults: false,
  normalize: (stored) => stored === true || stored === "true",
  legacyKey: "misty:sidebar-collapsed:v1",
});

/**
 * Whether the sidebar is tucked away. Unlike focus mode it leaves navigation
 * alone; a browser page then shows its own toolbar, which holds the button to bring it back.
 * The choice stays on this device.
 */
export const useSidebarCollapsedStore = create<{ collapsed: boolean; toggle(): void }>(
  (set, get) => ({
    collapsed: savedCollapsed.getState().value,
    // This window changes at once; the saved choice is what the next launch opens with.
    toggle: () => {
      const collapsed = !get().collapsed;
      restored = true;
      set({ collapsed });
      savedCollapsed.getState().set(collapsed);
    },
  }),
);

// Only the first answer from misty.db applies (the launch): collapsing the sidebar in one window
// doesn't collapse it in the others.
let restored = false;
savedCollapsed.subscribe(({ value, loaded }) => {
  if (!loaded || restored) return;
  restored = true;
  useSidebarCollapsedStore.setState({ collapsed: value });
});
