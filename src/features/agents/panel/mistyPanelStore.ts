import { create } from "zustand";

const widthKey = "misty:misty-panel-width";
export const MISTY_PANEL_WIDTH = 400;
export const MISTY_PANEL_MIN_WIDTH = 320;
export const MISTY_PANEL_MAX_WIDTH = 720;

export const clampMistyPanelWidth = (width: number) =>
  Math.round(Math.max(MISTY_PANEL_MIN_WIDTH, Math.min(MISTY_PANEL_MAX_WIDTH, width)));

// The width is a per-device layout convenience, like the agent sidebar's.
const readWidth = () => {
  try {
    const saved = Number(localStorage.getItem(widthKey));
    return saved ? clampMistyPanelWidth(saved) : MISTY_PANEL_WIDTH;
  } catch {
    return MISTY_PANEL_WIDTH;
  }
};
const writeWidth = (width: number) => {
  try {
    if (width === MISTY_PANEL_WIDTH) localStorage.removeItem(widthKey);
    else localStorage.setItem(widthKey, String(width));
  } catch {
    // Storage is optional; the width still holds for this session.
  }
};

interface MistyPanelState {
  open: boolean;
  /** The browser pane whose content area holds the panel; null lets the host pick one. */
  paneId: string | null;
  width: number;
  /** Opens in `paneId` when given, otherwise wherever the host resolves. */
  setOpen(open: boolean, paneId?: string | null): void;
  toggle(): void;
  setWidth(width: number): void;
}

/** The Misty panel: opens only when asked, by shortcut or the browser's Misty button. */
export const useMistyPanelStore = create<MistyPanelState>((set) => ({
  open: false,
  paneId: null,
  width: readWidth(),
  setOpen: (open, paneId) =>
    set((state) => ({ open, paneId: paneId === undefined ? state.paneId : paneId })),
  toggle: () => set((state) => ({ open: !state.open })),
  setWidth: (width) => {
    const value = clampMistyPanelWidth(width);
    writeWidth(value);
    set({ width: value });
  },
}));
