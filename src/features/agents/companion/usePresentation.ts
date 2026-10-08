import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { presentationEvent, type Presentation } from "./protocol";

const initial: Presentation = {
  generation: 0,
  phase: "idle",
  visible: false,
  mode: "team",
  model: "",
};

export function usePresentation() {
  const [state, setState] = useState(initial);
  useEffect(() => {
    let active = true;
    let receivedPresentation = false;
    const remove = getCurrentWindow().listen<Presentation>(presentationEvent, ({ payload }) => {
      receivedPresentation = true;
      if (active) setState(payload);
    });
    void remove
      .then(() => invoke<Presentation | null>("cursor_companion_snapshot"))
      .then((snapshot) => {
        if (active && !receivedPresentation && snapshot) setState(snapshot);
      })
      .catch(() => {
        if (active)
          void emit("misty://cursor-renderer-error", {
            error:
              "The cursor could not restore its display state. Restart Misty after updating the desktop app.",
          });
      });
    return () => {
      active = false;
      void remove.then((fn) => fn());
    };
  }, []);
  return state;
}
