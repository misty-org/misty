import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";

/**
 * Misty's own places in the sidebar: the Space's Files, and the Lab and Code pages. Each is
 * pinned by default; whatever the person unpins waits under More, and Reorder pins sets their
 * order.
 */
export const sidebarPlaceIds = ["files", "lab", "code"] as const;
export type SidebarPlaceId = (typeof sidebarPlaceIds)[number];

/** Every place in the person's order, and which of them are pinned. */
interface SidebarPins {
  order: SidebarPlaceId[];
  pinned: SidebarPlaceId[];
}

const scope = "sidebar-pins";
export const sidebarPinDefaults: SidebarPins = {
  order: [...sidebarPlaceIds],
  pinned: [...sidebarPlaceIds],
};

const known = (id: unknown): id is SidebarPlaceId => sidebarPlaceIds.includes(id as SidebarPlaceId);

/**
 * Drops places that no longer exist (an older Misty's Docs, Planner and the rest) and adds new
 * ones at the end, pinned.
 */
function normalize(stored: Partial<SidebarPins> | null): SidebarPins {
  if (!stored) return sidebarPinDefaults;
  const order = [...new Set((stored.order ?? []).filter(known))];
  const pinned = new Set((stored.pinned ?? []).filter(known));
  for (const id of sidebarPlaceIds) {
    if (order.includes(id)) continue;
    order.push(id);
    pinned.add(id);
  }
  return { order, pinned: order.filter((id) => pinned.has(id)) };
}

/** Which places are pinned and in what order, kept for this device in `misty.db`. */
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
