import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** What the panel beside a chat can show. */
export type ContextPanelTab = "session" | "steps" | "files" | "changes" | "terminal" | "preview";

/** The views that take the floating panel; the session card is a column of its own beside it. */
export type ContextPanelSurface = Exclude<ContextPanelTab, "session">;

/** The panel's width when it first opens, and the narrowest it goes. */
export const PANEL_DEFAULT_WIDTH = 440;
export const PANEL_MIN_WIDTH = 320;

/**
 * What is open beside the chats in this window: one surface in the floating panel (or none), and
 * the session card, which can stay open beside any of them. Pressing an open one closes it. The
 * panel keeps the width the person dragged it to, and can be widened to leave the chat narrow.
 * All of it is kept for the device in misty.db, so the panel comes back as it was left.
 */
export const useContextPanel = create<{
  tab: ContextPanelSurface | null;
  session: boolean;
  /** The session card is slid off the chat's right edge, back while the pointer rests there. */
  sessionTucked: boolean;
  width: number;
  expanded: boolean;
  toggle(tab: ContextPanelTab): void;
  show(tab: ContextPanelTab): void;
  close(): void;
  closeSession(): void;
  setSessionTucked(tucked: boolean): void;
  setWidth(width: number): void;
  toggleExpanded(): void;
}>((set, get) => ({
  tab: null,
  session: false,
  sessionTucked: false,
  width: PANEL_DEFAULT_WIDTH,
  expanded: false,
  // Pressing the session while its card is tucked brings the card back instead of closing it.
  toggle: (tab) =>
    tab === "session"
      ? get().session && get().sessionTucked
        ? set({ sessionTucked: false })
        : set({ session: !get().session })
      : set({ tab: get().tab === tab ? null : tab, expanded: false }),
  show: (tab) =>
    tab === "session" ? set({ session: true, sessionTucked: false }) : set({ tab }),
  close: () => set({ tab: null, expanded: false }),
  closeSession: () => set({ session: false }),
  setSessionTucked: (sessionTucked) => set({ sessionTucked }),
  setWidth: (width) =>
    set({ width: Math.max(PANEL_MIN_WIDTH, Math.round(width)), expanded: false }),
  toggleExpanded: () => set({ expanded: !get().expanded }),
}));

interface SavedContextPanel {
  tab: ContextPanelSurface | null;
  session: boolean;
  sessionTucked: boolean;
  width: number;
  expanded: boolean;
}

const surfaces: ContextPanelSurface[] = ["steps", "files", "changes", "terminal", "preview"];

const savedPanel = createDeviceSetting<SavedContextPanel>({
  scope: "context-panel",
  defaults: { tab: null, session: false, sessionTucked: false, width: PANEL_DEFAULT_WIDTH, expanded: false },
  normalize: (stored) => {
    const saved = stored as Partial<SavedContextPanel>;
    const tab = surfaces.find((surface) => surface === saved.tab) ?? null;
    return {
      tab,
      session: saved.session === true,
      sessionTucked: saved.sessionTucked === true,
      width:
        typeof saved.width === "number"
          ? Math.max(PANEL_MIN_WIDTH, Math.round(saved.width))
          : PANEL_DEFAULT_WIDTH,
      expanded: Boolean(tab) && saved.expanded === true,
    };
  },
});

useContextPanel.setState(savedPanel.getState().value);

// misty.db answers after the first frame. What is open comes only from that first answer, so
// opening a panel in one window does not open it in the others; the width follows them all.
let openRestored = false;
// A choice made before misty.db first answers wins over that first answer.
let touchedEarly = false;
// Set while another window's width is applied here, so it isn't saved back with this window's
// own open tab over that window's.
let applyingRemote = false;
savedPanel.subscribe((state) => {
  if (!state.loaded) return;
  const first = !openRestored;
  openRestored = true;
  applyingRemote = true;
  if (first && !touchedEarly) useContextPanel.setState(state.value);
  else if (!first) useContextPanel.setState({ width: state.value.width });
  applyingRemote = false;
});

// A drag sets the width on every move, so changes are saved once they rest.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useContextPanel.subscribe((state, previous) => {
  if (applyingRemote) return;
  if (!openRestored) touchedEarly = true;
  if (
    state.tab === previous.tab &&
    state.session === previous.session &&
    state.sessionTucked === previous.sessionTucked &&
    state.width === previous.width &&
    state.expanded === previous.expanded
  )
    return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { tab, session, sessionTucked, width, expanded } = useContextPanel.getState();
    const saved = savedPanel.getState().value;
    if (
      saved.tab === tab &&
      saved.session === session &&
      saved.sessionTucked === sessionTucked &&
      saved.width === width &&
      saved.expanded === expanded
    )
      return;
    savedPanel.getState().set({ tab, session, sessionTucked, width, expanded });
  }, 250);
});
