import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { ENDED_EVENT, FRAME_EVENT, type ScreenMemoryEnd, type ScreenMemoryFrame } from "./native";
import { createFrameSaver } from "./saveFrame";
import { ResumeCapturePrompt } from "./ResumeCapturePrompt";
import { useScreenCaptureStore } from "./useScreenCaptureStore";

/** Keeps what a running capture session reads, and tells the store when the session ends. */
export function ScreenMemoryMount() {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const save = createFrameSaver();
    const stops: Array<Promise<() => void>> = [
      listen<ScreenMemoryFrame>(FRAME_EVENT, async ({ payload }) => {
        const result = await save(payload);
        const store = useScreenCaptureStore.getState();
        if (result === "saved") store.frameSaved();
        if (result === "full") {
          await store.stop();
        }
      }),
      listen<{ reason: ScreenMemoryEnd; frames: number }>(ENDED_EVENT, ({ payload }) =>
        useScreenCaptureStore.getState().ended(payload.reason, payload.frames),
      ),
    ];
    void useScreenCaptureStore.getState().refresh();
    return () => {
      for (const stop of stops) void stop.then((off) => off());
    };
  }, []);
  return <ResumeCapturePrompt />;
}
