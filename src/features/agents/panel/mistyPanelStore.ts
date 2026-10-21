import { create } from "zustand";

const widthKey = "misty:misty-panel-width";
const chatWidthKey = "misty:misty-chat-panel-width";
const splitKey = "misty:misty-panel-split";
export const MISTY_PANEL_WIDTH = 400;
export const MISTY_PANEL_MIN_WIDTH = 360;
export const MISTY_PANEL_MAX_WIDTH = 720;
/** The top panel's share of the column while both are open. */
export const MISTY_PANEL_SPLIT = 0.5;
export const MISTY_PANEL_MIN_SPLIT = 0.2;
export const MISTY_PANEL_MAX_SPLIT = 0.8;

const clampMistyPanelWidth = (width: number) =>
  Math.round(Math.max(MISTY_PANEL_MIN_WIDTH, Math.min(MISTY_PANEL_MAX_WIDTH, width)));
const clampMistyPanelSplit = (split: number) =>
  Math.round(Math.max(MISTY_PANEL_MIN_SPLIT, Math.min(MISTY_PANEL_MAX_SPLIT, split)) * 1000) /
  1000;

// The sizes are per-device layout conveniences, like the agent sidebar's width.
const read = (key: string, fallback: number, clamp: (value: number) => number) => {
  try {
    const saved = Number(localStorage.getItem(key));
    return saved ? clamp(saved) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: number, fallback: number) => {
  try {
    if (value === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // Storage is optional; the size still holds for this session.
  }
};

/** The side panels: an agent conversation, and your Space's chat with people. */
export type MistyPanelView = "agents" | "chat";

interface MistyPanelState {
  /** The agent panel is open. (Its historic name: every `setOpen` caller means this panel.) */
  open: boolean;
  /** The chat panel is open. */
  chatOpen: boolean;
  /** Which panel sits on top while both are open: the one opened first. The other sits below
   * it, sharing the column's height by `split`. */
  first: MistyPanelView;
  /** The browser pane whose content area holds the panel; null lets the host pick one. */
  paneId: string | null;
  /** The agent panel's width. */
  width: number;
  /** The chat panel's width; each panel keeps its own. */
  chatWidth: number;
  /** The top panel's share of the column's height while both are open. */
  split: number;
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
  /** Sets one panel's width, the agent panel's unless `view` says otherwise. */
  setWidth(width: number, view?: MistyPanelView): void;
  setSplit(split: number): void;
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
  width: read(widthKey, MISTY_PANEL_WIDTH, clampMistyPanelWidth),
  chatWidth: read(chatWidthKey, MISTY_PANEL_WIDTH, clampMistyPanelWidth),
  split: read(splitKey, MISTY_PANEL_SPLIT, clampMistyPanelSplit),
  setOpen: (open, paneId) =>
    set((state) => ({
      ...opened(state, "agents", open),
      paneId: paneId === undefined ? state.paneId : paneId,
    })),
  toggle: () => set((state) => opened(state, "agents", !state.open)),
  show: (view) => set((state) => opened(state, view, !isOpen(state, view))),
  close: (view) => set((state) => opened(state, view, false)),
  closeAll: () => set({ open: false, chatOpen: false }),
  setWidth: (width, view = "agents") => {
    const value = clampMistyPanelWidth(width);
    write(view === "chat" ? chatWidthKey : widthKey, value, MISTY_PANEL_WIDTH);
    set(view === "chat" ? { chatWidth: value } : { width: value });
  },
  setSplit: (split) => {
    const value = clampMistyPanelSplit(split);
    write(splitKey, value, MISTY_PANEL_SPLIT);
    set({ split: value });
  },
}));

/** A panel's width. */
export const mistyPanelWidth = (state: MistyPanelState, view: MistyPanelView) =>
  view === "chat" ? state.chatWidth : state.width;
