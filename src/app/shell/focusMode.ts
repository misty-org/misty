import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** Kept for this device in `misty.db`; older builds kept it in the webview's storage. */
const savedFocusMode = createDeviceSetting<boolean>({
  scope: "focus-mode",
  defaults: false,
  normalize: (stored) => stored === true || stored === "true",
  legacyKey: "misty:focus-mode:v1",
});

/**
 * Focus mode hides the sidebar so pages fill the window.
 * The navigator still reveals at its edge; the choice stays on this device.
 */
export const useFocusModeStore = create<{ active: boolean; toggle(): void }>((set, get) => ({
  active: savedFocusMode.getState().value,
  // This window changes at once; the saved choice is what the next launch opens with.
  toggle: () => {
    const active = !get().active;
    restored = true;
    set({ active });
    savedFocusMode.getState().set(active);
  },
}));

// Only the first answer from misty.db applies (the launch): focus mode toggled in one window
// doesn't hide the chrome of the others.
let restored = false;
savedFocusMode.subscribe(({ value, loaded }) => {
  if (!loaded || restored) return;
  restored = true;
  useFocusModeStore.setState({ active: value });
});
