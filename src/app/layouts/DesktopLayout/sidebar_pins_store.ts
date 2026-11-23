import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/device_setting";

export const sidebarPlaceIds = ["files"] as const;
export type SidebarPlaceId = (typeof sidebarPlaceIds)[number];

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
    } catch {}
  },
  set(next) {
    const value = normalize(next);
    set(value);
    void updateDeviceState<SidebarPins>(
      scope,
      () => sidebarPinDefaults,
      () => value,
    )
      .then(() => announceDeviceSetting(scope))
      .catch(() => get().load());
  },
}));

onDeviceSettingChange(scope, () => void useSidebarPins.getState().load());
