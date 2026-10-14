import { create } from "zustand";

const storageKey = "misty:sidebar-collapsed:v1";

function read(): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

/**
 * Whether the vertical tab sidebar is tucked away. Unlike focus mode it leaves navigation
 * alone; a browser page then shows its own toolbar, which holds the button to bring it back.
 * The choice stays on this device.
 */
export const useSidebarCollapsedStore = create<{ collapsed: boolean; toggle(): void }>(
  (set, get) => ({
    collapsed: read(),
    toggle: () => {
      const collapsed = !get().collapsed;
      set({ collapsed });
      try {
        window.localStorage.setItem(storageKey, String(collapsed));
      } catch {
        /* The choice still applies for this session. */
      }
    },
  }),
);
