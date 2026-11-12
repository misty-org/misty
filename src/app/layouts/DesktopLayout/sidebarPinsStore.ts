import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";

/** The sidebar rows a person can pin. Whatever is not pinned waits under More. */
export const sidebarPlaceIds = ["search", "space", "integrations", "studio", "tutor"] as const;
export type SidebarPlaceId = (typeof sidebarPlaceIds)[number];

/** Every row in the person's order, and which of them are pinned. */
export interface SidebarPins {
  order: SidebarPlaceId[];
  pinned: SidebarPlaceId[];
}

const scope = "sidebar-pins";
const defaults: SidebarPins = {
  order: [...sidebarPlaceIds],
  pinned: ["search", "space", "integrations"],
};

const known = (id: unknown): id is SidebarPlaceId => sidebarPlaceIds.includes(id as SidebarPlaceId);
/** The studio was called the office. */
const renamed = (ids: unknown[] = []) => ids.map((id) => (id === "office" ? "studio" : id));

/** Drops rows that no longer exist and puts new ones at the end, pinned when they are by default. */
function normalize(stored: Partial<SidebarPins> | null): SidebarPins {
  if (!stored) return defaults;
  const order = [...new Set(renamed(stored.order).filter(known))];
  const pinned = new Set(renamed(stored.pinned).filter(known));
  for (const id of sidebarPlaceIds) {
    if (order.includes(id)) continue;
    order.push(id);
    if (defaults.pinned.includes(id)) pinned.add(id);
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
  ...defaults,
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
      () => defaults,
      () => value,
    ).catch(() => get().load());
  },
}));
