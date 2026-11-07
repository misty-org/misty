import { invoke } from "@tauri-apps/api/core";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Moves or resizes the panel inside its window. Tracked on the screen, because the page moves under
 * the pointer, and sent one change at a time, so a fast drag can't queue up behind itself.
 */
export function dragPanel(event: ReactPointerEvent<HTMLElement>, resizing: boolean) {
  const element = event.currentTarget;
  element.setPointerCapture(event.pointerId);
  // The grabbing hand. A resize keeps the corner's own cursor.
  if (!resizing) element.classList.add("is-dragging");
  let x = event.screenX;
  let y = event.screenY;
  let dx = 0;
  let dy = 0;
  let sending = false;
  const send = () => {
    if (sending || (!dx && !dy)) return;
    const frame = resizing ? { dx: 0, dy: 0, dw: dx, dh: dy } : { dx, dy, dw: 0, dh: 0 };
    dx = 0;
    dy = 0;
    sending = true;
    void invoke("voice_subtitles_frame", frame)
      .catch(() => undefined)
      .finally(() => {
        sending = false;
        send();
      });
  };
  const moved = (move: PointerEvent) => {
    dx += move.screenX - x;
    dy += move.screenY - y;
    x = move.screenX;
    y = move.screenY;
    send();
  };
  const ended = () => {
    element.classList.remove("is-dragging");
    element.removeEventListener("pointermove", moved);
    element.removeEventListener("pointerup", ended);
    element.removeEventListener("pointercancel", ended);
  };
  element.addEventListener("pointermove", moved);
  element.addEventListener("pointerup", ended);
  element.addEventListener("pointercancel", ended);
}
