import { create } from "zustand";

const focusModeStorageKey = "misty:focus-mode:v1";

function readFocusMode(): boolean {
  try {
    return window.localStorage.getItem(focusModeStorageKey) === "true";
  } catch {
    return false;
  }
}

/**
 * Focus mode hides the navigator and the tab strip together so pages fill the window.
 * The navigator still reveals at its edge; the choice stays on this device.
 */
export const useFocusModeStore = create<{ active: boolean; toggle(): void }>((set, get) => ({
  active: readFocusMode(),
  toggle: () => {
    const active = !get().active;
    set({ active });
    try {
      window.localStorage.setItem(focusModeStorageKey, String(active));
    } catch {
      /* The mode still applies for this session. */
    }
  },
}));
