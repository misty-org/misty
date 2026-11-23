import { create } from "zustand";
import {
  announceDeviceSetting,
  createDeviceSetting,
  onDeviceSettingChange,
} from "@/shared/lib/device_setting";
import type { BarLayout } from "@misty/ui";
import { readDeviceState, updateDeviceState } from "./folders/device_state";

export const railItemIds = [
  "new-task",
  "goal",
  "memory",
  "session",
  "steps",
  "changes",
  "files",
  "terminal",
  "browser",
] as const;
export type RailItemId = (typeof railItemIds)[number];

const scope = "context-rail";
const defaults: BarLayout = { order: [...railItemIds], hidden: [] };

let changes = 0;

const isItem = (id: unknown): id is RailItemId => railItemIds.includes(id as RailItemId);

function normalize(stored: Partial<BarLayout> | null): BarLayout {
  if (!stored) return defaults;
  const order: string[] = [...new Set((stored.order ?? []).filter(isItem))];
  for (const id of railItemIds) {
    if (order.includes(id)) continue;
    const before = railItemIds[railItemIds.indexOf(id) - 1];
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  }
  const hidden = [...new Set((stored.hidden ?? []).filter(isItem))];
  return { order, hidden };
}

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
    } catch {}
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
      .then(() => announceDeviceSetting(scope))
      .catch(() => get().load());
  },
  reset() {
    get().set(defaults);
  },
}));

onDeviceSettingChange(scope, () => void useRailLayout.getState().load());

export const useRailShown = createDeviceSetting<boolean>({
  scope: "context-rail-shown",
  defaults: false,
  normalize: (stored) => stored === true,
});
