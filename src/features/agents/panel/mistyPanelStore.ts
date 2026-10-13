import { create } from "zustand";

const widthKey = "misty:misty-panel-width";
export const MISTY_PANEL_WIDTH = 400;
export const MISTY_PANEL_MIN_WIDTH = 360;
export const MISTY_PANEL_MAX_WIDTH = 720;

const clampMistyPanelWidth = (width: number) =>
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

/** The side panels: an agent conversation, and your Space's chat with people. */
export type MistyPanelView = "agents" | "chat";

interface MistyPanelState {
  /** The agent panel is open. (Its historic name: every `setOpen` caller means this panel.) */
  open: boolean;
  /** The chat panel is open. */
  chatOpen: boolean;
  /** Which panel sits on top while both are open: the one opened first. The other splits the
   * column in half below it. */
  first: MistyPanelView;
  /** The browser pane whose content area holds the panel; null lets the host pick one. */
  paneId: string | null;
  width: number;
  /** Opens or closes the agent panel, in `paneId` when given, otherwise wherever the host
   * resolves. */
  setOpen(open: boolean, paneId?: string | null): void;
  /** The shortcut: the agent panel. */
  toggle(): void;
  /** The Agents and Chat buttons: opens `view`'s panel (below the other, if that is open), or
   * closes it when it is open. */
  show(view: MistyPanelView): void;
  /** Closes one panel; the other, if open, takes the whole column. */
  close(view: MistyPanelView): void;
  /** Closes both, as dragging the column shut does. */
  closeAll(): void;
  setWidth(width: number): void;
}

const isOpen = (state: MistyPanelState, view: MistyPanelView) =>
  view === "agents" ? state.open : state.chatOpen;

/** Opens or closes one panel; a panel opened while the other is closed goes on top. */
const opened = (
  state: MistyPanelState,
  view: MistyPanelView,
  next: boolean,
): Partial<MistyPanelState> => {
  const other = isOpen(state, view === "agents" ? "chat" : "agents");
  return {
    ...(view === "agents" ? { open: next } : { chatOpen: next }),
    ...(next && !other ? { first: view } : {}),
  };
};

/** The side panels: open only when asked, by shortcut or the Agents and Chat buttons. */
export const useMistyPanelStore = create<MistyPanelState>((set) => ({
  open: false,
  chatOpen: false,
  first: "agents",
  paneId: null,
  width: readWidth(),
  setOpen: (open, paneId) =>
    set((state) => ({
      ...opened(state, "agents", open),
      paneId: paneId === undefined ? state.paneId : paneId,
    })),
  toggle: () => set((state) => opened(state, "agents", !state.open)),
  show: (view) => set((state) => opened(state, view, !isOpen(state, view))),
  close: (view) => set((state) => opened(state, view, false)),
  closeAll: () => set({ open: false, chatOpen: false }),
  setWidth: (width) => {
    const value = clampMistyPanelWidth(width);
    writeWidth(value);
    set({ width: value });
  },
}));
