import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";

/** Everything the window's bottom bar can show. `bottomBarItems` says what each one is. */
export const bottomBarItemIds = [
  "agents",
  "server",
  "connection",
  "space",
  "presence",
  "approvals",
  "unread",
  "browsing",
  "tutor",
  "recording",
  "model",
  "context",
  "cost",
  "branch",
  "folder",
  "runtime",
  "newChat",
  "newTab",
  "search",
  "layout",
  "mistyPanel",
  "sidebar",
  "focus",
  "theme",
  "help",
  "zoom",
  "shortcuts",
  "info",
] as const;
export type BottomBarItemId = (typeof bottomBarItemIds)[number];

/**
 * What the bar shows, in order, at each end; an item in neither is hidden. `known` remembers
 * every item this device has seen, so one added in a later version takes its default place
 * while one the person hid stays hidden.
 */
export interface BottomBarLayout {
  start: BottomBarItemId[];
  end: BottomBarItemId[];
  known: BottomBarItemId[];
}

const scope = "bottom-bar";
/** A lean start: the rest wait in Settings › Interface › Bottom bar for whoever wants them. */
export const bottomBarDefaults: BottomBarLayout = {
  start: ["agents", "server"],
  end: ["zoom", "shortcuts", "info"],
  known: [...bottomBarItemIds],
};

const known = (id: unknown): id is BottomBarItemId =>
  bottomBarItemIds.includes(id as BottomBarItemId);

/** Drops items that no longer exist, keeps each in one place, and places new ones by default. */
function normalize(stored: Partial<BottomBarLayout> | null): BottomBarLayout {
  if (!stored) return bottomBarDefaults;
  const start = [...new Set((stored.start ?? []).filter(known))];
  const end = [...new Set((stored.end ?? []).filter(known))].filter((id) => !start.includes(id));
  const seen = new Set((stored.known ?? []).filter(known));
  for (const id of bottomBarItemIds) {
    if (seen.has(id) || start.includes(id) || end.includes(id)) continue;
    if (bottomBarDefaults.start.includes(id)) start.push(id);
    else if (bottomBarDefaults.end.includes(id)) end.push(id);
  }
  return { start, end, known: [...bottomBarItemIds] };
}

/** The bottom bar's items and their order, kept for this device in `misty.db`. */
export const useBottomBar = create<
  BottomBarLayout & {
    load(): Promise<void>;
    set(next: Omit<BottomBarLayout, "known">): void;
    reset(): void;
  }
>((set, get) => ({
  ...bottomBarDefaults,
  async load() {
    try {
      set(normalize(await readDeviceState<BottomBarLayout>(scope)));
    } catch {
      // The defaults stay.
    }
  },
  set(next) {
    const value = normalize({ ...next, known: [...bottomBarItemIds] });
    set(value);
    void updateDeviceState<BottomBarLayout>(
      scope,
      () => bottomBarDefaults,
      () => value,
    )
      // Every other window reads the new layout, so one still showing the old one can't save
      // it back over this change.
      .then(() => announceDeviceSetting(scope))
      .catch(() => get().load());
  },
  reset() {
    get().set(bottomBarDefaults);
  },
}));

onDeviceSettingChange(scope, () => void useBottomBar.getState().load());
