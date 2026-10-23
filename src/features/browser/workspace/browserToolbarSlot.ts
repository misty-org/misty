import { create } from "zustand";

/**
 * Where the tab sidebar wants the focused browser pane's toolbar: back/forward beside the
 * sidebar toggle, the address field below. The sidebar registers its slots here;
 * with a top slot present, that pane portals its toolbar into the sidebar and no pane keeps a
 * toolbar row of its own.
 */
export const useBrowserToolbarSlot = create<{
  nav: HTMLElement | null;
  top: HTMLElement | null;
  /** The sidebar footer's slot for the pane layout menu. */
  foot: HTMLElement | null;
  /** How many browser pages are filling the nav slot; the stand-in shows only at zero. */
  navClaims: number;
  setNav(slot: HTMLElement | null): void;
  setTop(slot: HTMLElement | null): void;
  setFoot(slot: HTMLElement | null): void;
  /** A page takes the nav slot; the returned function gives it back. */
  claimNav(): () => void;
}>((set) => ({
  nav: null,
  top: null,
  foot: null,
  navClaims: 0,
  claimNav: () => {
    set((state) => ({ navClaims: state.navClaims + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((state) => ({ navClaims: Math.max(0, state.navClaims - 1) }));
    };
  },
  setNav: (nav) => set({ nav }),
  setTop: (top) => set({ top }),
  setFoot: (foot) => set({ foot }),
}));
