import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";
import { spaceMadeKinds } from "@/shared/ui";

/**
 * The sidebar rows a person can pin: Misty's main places, then shortcuts to the window's Space's
 * own pages and its chat. Whatever is not pinned waits under More. Agents are set up in Settings
 * and picked in the composer.
 */
export const sidebarPlaceIds = [
  "search",
  "space",
  "code",
  "chat",
  "docs",
  "slides",
  "data",
  "whiteboards",
  "lab",
  "planner",
  "calendar",
  "media",
] as const;
/** The rows that open a page of the window's Space, by the section they open. */
export const spacePageSections: Partial<Record<SidebarPlaceId, string>> = {
  chat: "chat",
  ...Object.fromEntries(spaceMadeKinds.map((made) => [made.place, made.section])),
  lab: "lab",
  planner: "planner",
  calendar: "calendar",
  media: "media",
};
export type SidebarPlaceId = (typeof sidebarPlaceIds)[number];

/** Every row in the person's order, and which of them are pinned. */
interface SidebarPins {
  order: SidebarPlaceId[];
  pinned: SidebarPlaceId[];
}

const scope = "sidebar-pins";
export const sidebarPinDefaults: SidebarPins = {
  order: [...sidebarPlaceIds],
  // The Space's pages wait under More until the person pins them.
  pinned: ["search", "space", "code"],
};

const known = (id: unknown): id is SidebarPlaceId => sidebarPlaceIds.includes(id as SidebarPlaceId);
/**
 * Tutor and Notebooks became the Space's Lab, which has a row of its own again.
 * Agents (and Integrations, folded into it) moved into Settings, and the Studio (once the office)
 * is gone, so their rows are dropped.
 */
const formerly: Record<string, SidebarPlaceId> = {
  tutor: "lab",
  notebooks: "lab",
};
/** Rows that were once part of another one: Whiteboards were Docs' drawings. */
const splitFrom: Partial<Record<SidebarPlaceId, SidebarPlaceId>> = { whiteboards: "docs" };
/** Where a newer page goes: right after the page it belongs beside, Docs' kin after Docs. */
const placedAfter: Partial<Record<SidebarPlaceId, SidebarPlaceId>> = {
  slides: "docs",
  data: "slides",
  whiteboards: "data",
};
const renamed = (ids: unknown[] = []) =>
  ids.map((id) => (typeof id === "string" && formerly[id]) || id);

/**
 * Drops rows that no longer exist and adds new ones: beside the page they belong with
 * (`placedAfter`) when it's there, else at the end. A new row is pinned when it is by default, or
 * when the stored row it was split from (`splitFrom`) is pinned.
 */
function normalize(stored: Partial<SidebarPins> | null): SidebarPins {
  if (!stored) return sidebarPinDefaults;
  const order = [...new Set(renamed(stored.order).filter(known))];
  const pinned = new Set(renamed(stored.pinned).filter(known));
  const kept = new Set(order);
  for (const id of sidebarPlaceIds) {
    if (order.includes(id)) continue;
    const beside = placedAfter[id];
    const at = beside ? order.indexOf(beside) : -1;
    order.splice(at < 0 ? order.length : at + 1, 0, id);
    const from = splitFrom[id];
    const splitOff = from && kept.has(from) && pinned.has(from);
    if (sidebarPinDefaults.pinned.includes(id) || splitOff) pinned.add(id);
  }
  return { order, pinned: order.filter((id) => pinned.has(id)) };
}

/** Which sidebar rows are pinned and in what order, kept for this device in `misty.db`. */
export const useSidebarPins = create<
  SidebarPins & {
    load(): Promise<void>;
    set(next: SidebarPins): void;
  }
>((set, get) => ({
  ...sidebarPinDefaults,
  async load() {
    try {
      set(normalize(await readDeviceState<SidebarPins>(scope)));
    } catch {
      // The defaults stay.
    }
  },
  set(next) {
    const value = normalize(next);
    set(value);
    void updateDeviceState<SidebarPins>(
      scope,
      () => sidebarPinDefaults,
      () => value,
    )
      // Every other window reads the new layout, so one still showing the old one can't save
      // it back over this change.
      .then(() => announceDeviceSetting(scope))
      .catch(() => get().load());
  },
}));

onDeviceSettingChange(scope, () => void useSidebarPins.getState().load());
