import { create } from "zustand";
import { useSettingsStore } from "@/features/settings";
import { purgeExpiredScreenMemory } from "./purge";
import { screenMemoryNative, type ScreenMemoryEnd, type ScreenMemoryStatus } from "./native";
import { screenMemorySettings } from "./screenMemorySettings";

interface ScreenCaptureState {
  supported: boolean;
  running: boolean;
  startedAtMs: number | null;
  frames: number;
  /** Plain-language reason the last start failed or the session stopped by itself. */
  notice: string;
  /** A session ended by idling; when the person comes back they are asked about starting again. */
  askToResume: boolean;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  frameSaved: () => void;
  ended: (reason: ScreenMemoryEnd, frames: number) => void;
  clearNotice: () => void;
  dismissResume: () => void;
}

const endedNotice: Record<ScreenMemoryEnd, string> = {
  stopped: "",
  idle: "Capture stopped because you were away.",
  failed:
    "Capture stopped because Misty couldn't read the screen. Check screen access in System Settings.",
  "window-closed": "Capture stopped because its window closed.",
};

const apply = (status: ScreenMemoryStatus) => ({
  supported: status.supported,
  running: status.running,
  startedAtMs: status.startedAtMs ?? null,
  frames: status.frames ?? 0,
});

export const useScreenCaptureStore = create<ScreenCaptureState>()((set) => ({
  supported: false,
  running: false,
  startedAtMs: null,
  frames: 0,
  notice: "",
  askToResume: false,
  refresh: async () => {
    try {
      set(apply(await screenMemoryNative.status()));
    } catch {
      set({ supported: false, running: false });
    }
  },
  start: async () => {
    set({ notice: "", askToResume: false });
    try {
      const status = await screenMemoryNative.status(true);
      if (!status.supported) {
        set({ notice: "Screen capture isn't available on this system yet." });
        return;
      }
      if (!status.allowed) {
        set({ notice: "Allow screen access for Misty in System Settings, then try again." });
        return;
      }
      const settings = screenMemorySettings(useSettingsStore.getState().settings?.document);
      const started = await screenMemoryNative.start({
        intervalSecs: 10,
        idleSecs: settings.idleMinutes * 60,
        excludedApps: settings.excludedApps,
      });
      set({ running: true, startedAtMs: started.startedAtMs, frames: 0 });
      void purgeExpiredScreenMemory(settings.keepDays).catch(() => {});
    } catch {
      set({ notice: "Capture couldn't start. Try again." });
    }
  },
  stop: async () => {
    try {
      await screenMemoryNative.stop();
    } catch {
      set({ notice: "Capture couldn't stop. Try again." });
    }
  },
  frameSaved: () => set((s) => ({ frames: s.frames + 1 })),
  ended: (reason, frames) =>
    set({
      running: false,
      startedAtMs: null,
      frames,
      notice: endedNotice[reason],
      askToResume: reason === "idle",
    }),
  clearNotice: () => set({ notice: "" }),
  dismissResume: () => set({ askToResume: false }),
}));
