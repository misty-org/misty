import type { DrawingSession } from "../drawingRuntime";

export function createPointerPublisher(session: DrawingSession) {
  let timer: number | null = null;
  let pending:
    | {
        pointer: { x: number; y: number; tool: "pointer" | "laser" };
        button: "down" | "up";
      }
    | undefined;
  const flush = () => {
    timer = null;
    if (!pending) return;
    session.provider.awareness.setLocalStateField("pointer", pending.pointer);
    session.provider.awareness.setLocalStateField("button", pending.button);
    pending = undefined;
  };
  return {
    publish(payload: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "down" | "up";
    }) {
      pending = payload;
      if (timer == null) timer = window.setTimeout(flush, 33);
    },
    destroy() {
      if (timer != null) window.clearTimeout(timer);
    },
  };
}
