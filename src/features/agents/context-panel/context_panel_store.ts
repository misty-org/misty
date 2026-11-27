import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export type ContextPanelTab =
  "session" | "goal" | "steps" | "files" | "changes" | "terminal" | "memory" | "profile";

export type ContextPanelSurface = Exclude<ContextPanelTab, "session">;

export const PANEL_DEFAULT_WIDTH = 440;
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 1280;
export const CHAT_MIN_WIDTH = 360;

export const useContextPanel = create<{
  tab: ContextPanelSurface | null;
  session: boolean;
  expanded: boolean;
  toggle(tab: ContextPanelTab): void;
  show(tab: ContextPanelTab): void;
  close(): void;
  closeSession(): void;
  toggleExpanded(): void;
}>((set, get) => ({
  tab: null,
  session: false,
  expanded: false,
  toggle: (tab) =>
    tab === "session"
      ? set({ session: !get().session })
      : set({ tab: get().tab === tab ? null : tab, expanded: false }),
  show: (tab) => (tab === "session" ? set({ session: true }) : set({ tab })),
  close: () => set({ tab: null, expanded: false }),
  closeSession: () => set({ session: false }),
  toggleExpanded: () => set({ expanded: !get().expanded }),
}));

interface SavedContextPanel {
  tab: ContextPanelSurface | null;
  session: boolean;
  expanded: boolean;
}

const surfaces: ContextPanelSurface[] = [
  "goal",
  "steps",
  "files",
  "changes",
  "terminal",
  "memory",
  "profile",
];

const savedPanel = createDeviceSetting<SavedContextPanel>({
  scope: "context-panel",
  defaults: {
    tab: null,
    session: false,
    expanded: false,
  },
  normalize: (stored) => {
    const saved = stored as Partial<SavedContextPanel>;
    const tab = surfaces.find((surface) => surface === saved.tab) ?? null;
    return {
      tab,
      session: saved.session === true,
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
  applyingRemote = false;
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useContextPanel.subscribe((state, previous) => {
  if (applyingRemote) return;
  if (!openRestored) touchedEarly = true;
  if (
    state.tab === previous.tab &&
    state.session === previous.session &&
    state.expanded === previous.expanded
  )
    return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { tab, session, expanded } = useContextPanel.getState();
    const saved = savedPanel.getState().value;
    if (saved.tab === tab && saved.session === session && saved.expanded === expanded) return;
    savedPanel.getState().set({ tab, session, expanded });
  }, 250);
});
