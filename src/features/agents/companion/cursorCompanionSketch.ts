import { useMistyStore } from "@/features/misty/useMistyStore";
import { mapSketch, parseSketch, type Sketch } from "./companionSketch";
import type { CursorCompanionSession } from "./cursorCompanionSession";

/** How long a finished drawing stays once it has been read. */
export const SKETCH_HOLD_MS = 30_000;
/** A drawing whose reply is never read aloud stays this long after it finishes. */
const SKETCH_UNREAD_HOLD_MS = 60_000;

/**
 * Draws a reply's sketch at the cursor while the reply streams (companionSketch.ts):
 * each finished line reaches the overlay as it arrives. Screen marks move from their
 * screenshot's pixels to the display they mark. The overlay ignores the mouse, so a
 * drawing clears on its own after it is read, or with the next turn or Stop.
 */
export class CursorCompanionSketch {
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shown = "";

  constructor(private readonly s: CursorCompanionSession) {}

  /** Follows the reply of `invocationId` until it ends. */
  follow = (invocationId: string) => {
    this.cancel();
    const expected = this.s.turn;
    const check = () => {
      if (!this.s.active(expected)) return this.cancel();
      const reply = useMistyStore
        .getState()
        .conversations.flatMap((c) => c.messages)
        .find((m) => m.role === "assistant" && m.invocationId === invocationId);
      if (!reply) return;
      const sketch = parseSketch(reply.content);
      if (sketch) this.publish(sketch, invocationId);
      if (reply.state === "completed" || reply.state === "failed" || reply.state === "canceled") {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        if (sketch) this.release(SKETCH_UNREAD_HOLD_MS);
      }
    };
    this.unsubscribe = useMistyStore.subscribe(check);
    check();
  };

  /** Keeps the drawing `holdMs` longer, then clears it, such as once it has been read. */
  release = (holdMs = SKETCH_HOLD_MS) => {
    if (!this.s.state.sketch) return;
    clearTimeout(this.timer);
    const expected = this.s.turn;
    this.timer = setTimeout(() => {
      if (this.s.active(expected)) this.clear();
    }, holdMs);
  };

  /** Stops following without changing what is shown. */
  cancel = () => {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.timer);
  };

  clear = () => {
    this.cancel();
    this.shown = "";
    if (this.s.state.sketch) this.s.change({ sketch: undefined });
  };

  private publish = (sketch: Sketch, invocationId: string) => {
    const key = `${invocationId}:${sketch.elements.length}:${sketch.done}`;
    if (key === this.shown) return;
    this.shown = key;
    const { header } = sketch;
    if (header.surface === "screen") {
      const capture = header.screen
        ? this.s.captures.find((c) => c.screen === header.screen)
        : this.s.captures.find((c) => c.primary);
      // Marks without the screenshot they name have nowhere to go.
      if (!capture || capture.width <= 0 || capture.height <= 0) return;
      const { display } = capture;
      this.s.change({
        sketch: {
          id: invocationId,
          surface: "screen",
          title: header.title,
          displayId: display.id,
          done: sketch.done,
          elements: mapSketch(sketch.elements, {
            scaleX: display.width / capture.width,
            scaleY: display.height / capture.height,
            dx: display.x,
            dy: display.y,
          }),
        },
      });
      return;
    }
    this.s.change({
      sketch: {
        id: invocationId,
        surface: "board",
        title: header.title,
        // The display the person was on when they asked; one card, on one display.
        displayId: this.s.captures.find((c) => c.primary)?.display.id,
        done: sketch.done,
        elements: sketch.elements,
      },
    });
  };
}
