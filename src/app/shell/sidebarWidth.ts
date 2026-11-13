import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

const sidebarWidthDefault = 320;
/** The narrowest the sidebar goes: the window controls, the sidebar toggle, and back and forward
 * all still fit in its head. */
export const sidebarWidthMin = 200;
const sidebarWidthMax = 480;

const clamp = (value: number) =>
  Math.min(sidebarWidthMax, Math.max(sidebarWidthMin, Math.round(value)));

/** The width kept for this device in `misty.db`; older builds kept it in the webview's storage. */
const savedWidth = createDeviceSetting<number>({
  scope: "sidebar-width",
  defaults: sidebarWidthDefault,
  normalize: (stored) => {
    const width = Number(stored);
    return Number.isFinite(width) && width > 0 ? clamp(width) : sidebarWidthDefault;
  },
  legacyKey: "misty:sidebar-width:v1",
});

/** A save waiting for the drag to rest; while one waits, a reload doesn't pull the edge back. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** The sidebar's width. The choice stays on this device. */
export const useSidebarWidthStore = create<{
  width: number;
  set(width: number): void;
  reset(): void;
}>((set) => {
  const apply = (width: number) => {
    set({ width });
    // A drag sets the width on every move; only where it comes to rest is saved.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      savedWidth.getState().set(width);
    }, 250);
  };
  return {
    width: savedWidth.getState().value,
    set: (width) => apply(clamp(width)),
    reset: () => apply(sidebarWidthDefault),
  };
});

savedWidth.subscribe(({ value }, previous) => {
  if (value !== previous.value && saveTimer === undefined)
    useSidebarWidthStore.setState({ width: value });
});
