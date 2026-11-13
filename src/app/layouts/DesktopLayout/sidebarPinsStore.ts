import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";

/** The sidebar rows a person can pin. Whatever is not pinned waits under More. */
export const sidebarPlaceIds = [
  "search",
  "agents",
  "space",
  "integrations",
  "studio",
  "lab",
] as const;
export type SidebarPlaceId = (typeof sidebarPlaceIds)[number];

/** Every row in the person's order, and which of them are pinned. */
interface SidebarPins {
  order: SidebarPlaceId[];
  pinned: SidebarPlaceId[];
}

const scope = "sidebar-pins";
export const sidebarPinDefaults: SidebarPins = {
  order: [...sidebarPlaceIds],
  // The Lab is where someone new learns with their AI, so it is in view from the start. Agents,
  // where engines are installed and set up, is too.
  pinned: ["search", "agents", "space", "lab", "integrations"],
};

const known = (id: unknown): id is SidebarPlaceId => sidebarPlaceIds.includes(id as SidebarPlaceId);
/** The studio was called the office, and the Lab was Tutor, then Notebooks. */
const formerly: Record<string, SidebarPlaceId> = {
  office: "studio",
  tutor: "lab",
  notebooks: "lab",
};
const renamed = (ids: unknown[] = []) =>
  ids.map((id) => (typeof id === "string" && formerly[id]) || id);

/** Drops rows that no longer exist and puts new ones at the end, pinned when they are by default. */
function normalize(stored: Partial<SidebarPins> | null): SidebarPins {
  if (!stored) return sidebarPinDefaults;
  const order = [...new Set(renamed(stored.order).filter(known))];
  const pinned = new Set(renamed(stored.pinned).filter(known));
  for (const id of sidebarPlaceIds) {
    if (order.includes(id)) continue;
    order.push(id);
    if (sidebarPinDefaults.pinned.includes(id)) pinned.add(id);
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
