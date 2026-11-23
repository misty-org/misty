import { emit } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef } from "react";
import "@/styles/styles.css";
import { CursorOverlayMarkup } from "./CursorOverlayMarkup";
import { startCursorOverlayLoop } from "./cursor_overlay_loop";
import { TutorShotLayer } from "./TutorShotLayer";
import { usePresentation } from "./use_presentation";

export function CursorCompanionRoot() {
  return <CursorOverlay />;
}

function CursorOverlay() {
  const presentation = usePresentation();
  const latest = useRef(presentation);
  latest.current = presentation;
  const group = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const focus = useRef<HTMLDivElement>(null);
  const sketch = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stop = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "drop" && payload.paths.length)
        void emit("misty://cursor-drop", { paths: payload.paths });
    });
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  useEffect(
    () =>
      startCursorOverlayLoop({
        latest,
        group,
        bubble,
        marker,
        meter,
        focus,
        sketch,
        trail,
        caption,
      }),
    [],
  );
  return (
    <>
      <CursorOverlayMarkup
        presentation={presentation}
        marker={marker}
        focus={focus}
        sketch={sketch}
        trail={trail}
        caption={caption}
        group={group}
        bubble={bubble}
        meter={meter}
      />
      <TutorShotLayer />
    </>
  );
}
