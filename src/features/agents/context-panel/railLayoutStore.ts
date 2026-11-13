import { create } from "zustand";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";
import type { BarLayout } from "@/shared/ui";
import { readDeviceState, updateDeviceState } from "./folders/deviceState";

/** Everything the chat's right rail can show, in its default order. */
export const railItemIds = [
  "new-task",
  "goal",
  "session",
  "steps",
  "changes",
  "files",
  "terminal",
  "browser",
  "preview",
] as const;
export type RailItemId = (typeof railItemIds)[number];

const scope = "context-rail";
const defaults: BarLayout = { order: [...railItemIds], hidden: [] };

/** Bumped by every change, so a read that began before one can't put the old layout back. */
let changes = 0;

const isItem = (id: unknown): id is RailItemId => railItemIds.includes(id as RailItemId);

/** Drops items that no longer exist and puts new ones where they go by default, shown: only
 * what the person hid is hidden. */
function normalize(stored: Partial<BarLayout> | null): BarLayout {
  if (!stored) return defaults;
  const order: string[] = [...new Set((stored.order ?? []).filter(isItem))];
  for (const id of railItemIds) {
    if (order.includes(id)) continue;
    // After the item it follows by default, or first.
    const before = railItemIds[railItemIds.indexOf(id) - 1];
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  }
  const hidden = [...new Set((stored.hidden ?? []).filter(isItem))];
  return { order, hidden };
}

/** The rail's order and the items the person hid, kept for this device in `misty.db`. */
export const useRailLayout = create<
  BarLayout & {
    load(): Promise<void>;
    set(next: BarLayout): void;
    reset(): void;
  }
>((set, get) => ({
  ...defaults,
  async load() {
    const started = changes;
    try {
      const stored = await readDeviceState<BarLayout>(scope);
      if (started === changes) set(normalize(stored));
    } catch {
      // The defaults stay.
    }
  },
  set(next) {
    const value = normalize(next);
    changes += 1;
    set(value);
    void updateDeviceState<BarLayout>(
      scope,
      () => defaults,
      () => value,
    )
      // Every other window reads the new layout, so one still showing the old can't save it back.
      .then(() => announceDeviceSetting(scope))
      .catch(() => get().load());
  },
  reset() {
    get().set(defaults);
  },
}));

onDeviceSettingChange(scope, () => void useRailLayout.getState().load());
