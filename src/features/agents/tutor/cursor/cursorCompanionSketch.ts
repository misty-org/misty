import { useMistyStore } from "../../conversations/state/useMistyStore";
import { withPictures } from "./companionPictures";
import { mapSketch, parseSketch, type Sketch } from "./companionSketch";
import type { CursorCompanionSession } from "./cursorCompanionSession";

/** How long a finished board stays once it has been read. */
const SKETCH_HOLD_MS = 30_000;
/** Marks over the screen clear soon after they've been said, so the page is the person's again. */
const SCREEN_MARKS_HOLD_MS = 2_500;
/** A drawing whose reply is never read aloud stays this long after it finishes. */
const SKETCH_UNREAD_HOLD_MS = 60_000;

/**
 * Draws a reply's sketch at the cursor while the reply streams (companionSketch.ts):
 * each finished line reaches the overlay as it arrives, or, for a spoken answer, as the
 * voice begins the sentence that brings it in (`show`). Screen marks move from their
 * screenshot's pixels to the display they mark. The overlay ignores the mouse, so a
 * drawing clears on its own after it is read, or with the next turn or Stop.
 */
export class CursorCompanionSketch {
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shown = "";
  /** The drawing last shown, to show again once a picture in it arrives. */
  private last: { sketch: Sketch; id: string; turn: number } | undefined;

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

  /**
   * A spoken answer's drawing so far, showing only the elements in `shown` (all of them when
   * undefined). `id` stays the same for the whole answer, so its board isn't placed again.
   */
  show = (answer: string, id: string, shown?: ReadonlySet<string>) => {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.timer);
    const sketch = parseSketch(answer);
    if (!sketch) return;
    this.publish(
      shown ? { ...sketch, elements: sketch.elements.filter((e) => shown.has(e.id)) } : sketch,
      id,
    );
  };

  /** Everything drawn has been said: marks over the screen clear soon, a board stays a while. */
  readOut = () =>
    this.release(this.s.state.sketch?.surface === "screen" ? SCREEN_MARKS_HOLD_MS : SKETCH_HOLD_MS);

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

  private publish = (drawn: Sketch, invocationId: string) => {
    const turn = this.s.turn;
    this.last = { sketch: drawn, id: invocationId, turn };
    // Pictures arrive after the drawing; it's shown again with each one.
    const sketch = {
      ...drawn,
      elements: withPictures(drawn.elements, () => {
        const last = this.last;
        if (last && last.turn === turn && this.s.active(turn) && this.s.state.sketch?.id === last.id)
          this.publish(last.sketch, last.id);
      }),
    };
    const pictures = sketch.elements.filter((e) => e.src).length;
    const key = `${invocationId}:${sketch.elements.length}:${pictures}:${sketch.done}`;
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
        surface: header.surface,
        title: header.title,
        // The display the person was on when they asked; one card, on one display.
        displayId: this.s.captures.find((c) => c.primary)?.display.id,
        done: sketch.done,
        elements: sketch.elements,
      },
    });
  };
}
