import { useEffect, useRef } from "react";
import "./cursorCompanion.css";
import { CursorOverlayMarkup } from "./CursorOverlayMarkup";
import { startCursorOverlayLoop } from "./cursorOverlayLoop";
import { usePresentation } from "./usePresentation";

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
  useEffect(
    () => startCursorOverlayLoop({ latest, group, bubble, marker, meter, focus, sketch }),
    [],
  );
  return (
    <CursorOverlayMarkup
      presentation={presentation}
      marker={marker}
      focus={focus}
      sketch={sketch}
      group={group}
      bubble={bubble}
      meter={meter}
    />
  );
}
