import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export type ContextPanelTab = "session" | "steps" | "files" | "changes" | "terminal" | "profile";

export type ContextPanelSurface = Exclude<ContextPanelTab, "session">;

export const PANEL_DEFAULT_WIDTH = 440;
export const PANEL_MIN_WIDTH = 320;

export const useContextPanel = create<{
  tab: ContextPanelSurface | null;
  session: boolean;
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
  toggle: (tab) =>
    tab === "session"
      ? get().session && get().sessionTucked
        ? set({ sessionTucked: false })
        : set({ session: !get().session })
      : set({ tab: get().tab === tab ? null : tab, expanded: false }),
  show: (tab) => (tab === "session" ? set({ session: true, sessionTucked: false }) : set({ tab })),
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

const surfaces: ContextPanelSurface[] = ["steps", "files", "changes", "terminal", "profile"];

const savedPanel = createDeviceSetting<SavedContextPanel>({
  scope: "context-panel",
  defaults: {
    tab: null,
    session: false,
    sessionTucked: false,
    width: PANEL_DEFAULT_WIDTH,
    expanded: false,
  },
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

let openRestored = false;
let touchedEarly = false;
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
