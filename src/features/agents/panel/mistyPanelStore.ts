import { create } from "zustand";

const widthKey = "misty:misty-panel-width";
export const MISTY_PANEL_WIDTH = 400;
export const MISTY_PANEL_MIN_WIDTH = 360;
export const MISTY_PANEL_MAX_WIDTH = 720;

const clampMistyPanelWidth = (width: number) =>
  Math.round(Math.max(MISTY_PANEL_MIN_WIDTH, Math.min(MISTY_PANEL_MAX_WIDTH, width)));

// The width is a per-device layout convenience, like the agent sidebar's width.
const readWidth = () => {
  try {
    const saved = Number(localStorage.getItem(widthKey));
    return saved ? clampMistyPanelWidth(saved) : MISTY_PANEL_WIDTH;
  } catch {
    return MISTY_PANEL_WIDTH;
  }
};
const writeWidth = (value: number) => {
  try {
    if (value === MISTY_PANEL_WIDTH) localStorage.removeItem(widthKey);
    else localStorage.setItem(widthKey, String(value));
  } catch {
    // Storage is optional; the size still holds for this session.
  }
};

/** The side panel: your Space's chat with people. */
export type MistyPanelView = "chat";

interface MistyPanelState {
  /** The chat panel is open. */
  chatOpen: boolean;
  /** The panel's width. */
  width: number;
  /** The shortcut: opens the chat panel, or closes it when it is open. */
  toggle(): void;
  /** Closes the panel, as its close button and dragging it shut do. */
  close(): void;
  /** Sets the panel's width. */
  setWidth(width: number): void;
}

/** The side panel: open only when asked, by its shortcut. */
export const useMistyPanelStore = create<MistyPanelState>((set) => ({
  chatOpen: false,
  width: readWidth(),
  toggle: () => set((state) => ({ chatOpen: !state.chatOpen })),
  close: () => set({ chatOpen: false }),
  setWidth: (width) => {
    const value = clampMistyPanelWidth(width);
    writeWidth(value);
    set({ width: value });
  },
}));
