import { create } from "zustand";

const storageKey = "misty:sidebar-width:v1";
export const sidebarWidthDefault = 240;
export const sidebarWidthMin = 200;
export const sidebarWidthMax = 420;

const clamp = (value: number) =>
  Math.min(sidebarWidthMax, Math.max(sidebarWidthMin, Math.round(value)));

function read(): number {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : sidebarWidthDefault;
  } catch {
    return sidebarWidthDefault;
  }
}

/** The vertical tab sidebar's width. The choice stays on this device. */
export const useSidebarWidthStore = create<{
  width: number;
  set(width: number): void;
  reset(): void;
}>((set) => {
  const apply = (width: number) => {
    set({ width });
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      /* The width still applies for this session. */
    }
  };
  return {
    width: read(),
    set: (width) => apply(clamp(width)),
    reset: () => apply(sidebarWidthDefault),
  };
});
