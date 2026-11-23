import { useEffect, useRef } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import { useCallStore } from "./call_store";
import type { CallControls } from "./use_live_kit_call";

export function useCallShortcuts(controls: CallControls) {
  const live = useCallStore((state) => state.active?.state === "live");
  const current = useRef(controls);
  current.current = controls;
  const holding = useRef<(() => void) | null>(null);
  useShortcutHandler("call.toggle_mic", () => current.current.toggleMic(), live);
  useShortcutHandler("call.toggle_camera", () => current.current.toggleCamera(), live);
  useShortcutHandler("call.raise_hand", () => current.current.toggleHand(), live);
  useShortcutHandler("call.toggle_captions", () => current.current.toggleCaptions(), live);
  useShortcutHandler(
    "call.push_to_talk",
    ({ event }) => {
      if (holding.current || current.current.micOn) return;
      const mic = useCallStore.getState().mic;
      if (!mic) return false;
      mic.set(true);
      const key = event.key;
      const release = (up?: KeyboardEvent) => {
        if (up && up.key !== key) return;
        window.removeEventListener("keyup", release);
        window.removeEventListener("blur", blur);
        holding.current = null;
        useCallStore.getState().mic?.set(false);
      };
      const blur = () => release();
      window.addEventListener("keyup", release);
      window.addEventListener("blur", blur);
      holding.current = blur;
    },
    live,
  );
  useEffect(() => () => holding.current?.(), []);
}
