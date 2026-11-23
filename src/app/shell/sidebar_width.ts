import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";

const sidebarWidthDefault = 320;
export const sidebarWidthMin = 280;
const sidebarWidthMax = 480;

const clamp = (value: number) =>
  Math.min(sidebarWidthMax, Math.max(sidebarWidthMin, Math.round(value)));

const savedWidth = createDeviceSetting<number>({
  scope: "sidebar-width",
  defaults: sidebarWidthDefault,
  normalize: (stored) => {
    const width = Number(stored);
    return Number.isFinite(width) && width > 0 ? clamp(width) : sidebarWidthDefault;
  },
  legacyKey: "misty:sidebar-width:v1",
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useSidebarWidthStore = create<{
  width: number;
  set(width: number): void;
  reset(): void;
}>((set) => {
  const apply = (width: number) => {
    set({ width });
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
