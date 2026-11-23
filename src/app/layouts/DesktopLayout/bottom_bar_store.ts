import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/device_setting";

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
  "theme",
  "help",
  "zoom",
  "shortcuts",
  "info",
] as const;
export type BottomBarItemId = (typeof bottomBarItemIds)[number];

export interface BottomBarLayout {
  start: BottomBarItemId[];
  end: BottomBarItemId[];
  known: BottomBarItemId[];
}

const scope = "bottom-bar";
export const bottomBarDefaults: BottomBarLayout = {
  start: ["agents", "server"],
  end: ["branch", "zoom", "shortcuts", "info"],
  known: [...bottomBarItemIds],
};

const known = (id: unknown): id is BottomBarItemId =>
  bottomBarItemIds.includes(id as BottomBarItemId);

function normalize(stored: Partial<BottomBarLayout> | null): BottomBarLayout {
  if (!stored) return bottomBarDefaults;
  const start = [...new Set((stored.start ?? []).filter(known))];
  const end = [...new Set((stored.end ?? []).filter(known))].filter((id) => !start.includes(id));
  const seen = new Set((stored.known ?? []).filter(known));
  const shown = (id: BottomBarItemId) => start.includes(id) || end.includes(id);
  const place = (id: BottomBarItemId) => {
    for (const [list, defaults] of [
      [start, bottomBarDefaults.start],
      [end, bottomBarDefaults.end],
    ] as const) {
      const at = defaults.indexOf(id);
      if (at < 0) continue;
      const next = defaults.slice(at + 1).find((other) => list.includes(other));
      list.splice(next ? list.indexOf(next) : list.length, 0, id);
      return;
    }
  };
  for (const id of bottomBarItemIds) if (!seen.has(id) && !shown(id)) place(id);
  return { start, end, known: [...bottomBarItemIds] };
}

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
    } catch {}
  },
  set(next) {
    const value = normalize({ ...next, known: [...bottomBarItemIds] });
    set(value);
    void updateDeviceState<BottomBarLayout>(
      scope,
      () => bottomBarDefaults,
      () => value,
    )
      .then(() => announceDeviceSetting(scope))
      .catch(() => get().load());
  },
  reset() {
    get().set(bottomBarDefaults);
  },
}));

onDeviceSettingChange(scope, () => void useBottomBar.getState().load());
