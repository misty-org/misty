// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/device_setting";
import { agentAccountId } from "../../personal/agent_account";
import { readDeviceState, updateDeviceState } from "../folders/device_state";

interface TreePreferencesDocument {
  hideIgnored?: boolean;
}

const scope = () => `project-files:${agentAccountId()}`;
const announced = "project-files";

let writeGeneration = 0;
let pendingWrites = 0;

export const useTreePreferences = create<{
  hideIgnored: boolean;
  hydrate(): Promise<void>;
  setHideIgnored(hide: boolean): Promise<void>;
}>((set, get) => ({
  hideIgnored: false,
  async hydrate() {
    const generation = writeGeneration;
    try {
      const stored = await readDeviceState<TreePreferencesDocument>(scope());
      if (generation !== writeGeneration || pendingWrites > 0) return;
      set({ hideIgnored: stored?.hideIgnored === true });
    } catch {}
  },
  async setHideIgnored(hide) {
    const previous = get().hideIgnored;
    writeGeneration += 1;
    const generation = writeGeneration;
    pendingWrites += 1;
    set({ hideIgnored: hide });
    try {
      await updateDeviceState<TreePreferencesDocument>(
        scope(),
        () => ({}),
        (current) => ({ ...current, hideIgnored: hide }),
      );
      announceDeviceSetting(announced);
    } catch (error) {
      if (generation === writeGeneration) set({ hideIgnored: previous });
      throw error;
    } finally {
      pendingWrites -= 1;
    }
  },
}));

onDeviceSettingChange(announced, () => void useTreePreferences.getState().hydrate());
