// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";
import { agentAccountId } from "../../personal/agentAccount";
import { readDeviceState, updateDeviceState } from "../folders/deviceState";

interface TreePreferencesDocument {
  hideIgnored?: boolean;
}

const scope = () => `project-files:${agentAccountId()}`;
/** What windows tell each other after a save; each reloads its own account's document. */
const announced = "project-files";

/** Bumped by every write: only the newest may roll the switch back, and a read that began
 * before it must not overwrite it. */
let writeGeneration = 0;
let pendingWrites = 0;

/**
 * How the file tree shows what Git ignores, kept for this device in `misty.db`. A store rather
 * than a one-off read: the tree filters again the moment the switch flips.
 */
export const useTreePreferences = create<{
  /** Hide what Git ignores; false (the default) lists it faded. */
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
    } catch {
      // The default stays: ignored entries are listed, faded.
    }
  },
  async setHideIgnored(hide) {
    const previous = get().hideIgnored;
    writeGeneration += 1;
    const generation = writeGeneration;
    pendingWrites += 1;
    // Applied first, so the tree filters at once; a failed write rolls the switch back.
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
