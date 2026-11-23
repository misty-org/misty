import { useMistyStore } from "../../conversations/state/use_misty_store";
import { withPictures } from "./companion_pictures";
import { mapSketch, parseSketch, type Sketch } from "./companion_sketch";
import type { CursorCompanionSession } from "./cursor_companion_session";

const SKETCH_HOLD_MS = 30_000;
const SCREEN_MARKS_HOLD_MS = 2_500;
const SKETCH_UNREAD_HOLD_MS = 60_000;

export class CursorCompanionSketch {
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shown = "";
  private last: { sketch: Sketch; id: string; turn: number } | undefined;

  constructor(private readonly s: CursorCompanionSession) {}

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

  readOut = () =>
    this.release(this.s.state.sketch?.surface === "screen" ? SCREEN_MARKS_HOLD_MS : SKETCH_HOLD_MS);

  release = (holdMs = SKETCH_HOLD_MS) => {
    if (!this.s.state.sketch) return;
    clearTimeout(this.timer);
    const expected = this.s.turn;
    this.timer = setTimeout(() => {
      if (this.s.active(expected)) this.clear();
    }, holdMs);
  };

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
    const sketch = {
      ...drawn,
      elements: withPictures(drawn.elements, () => {
        const last = this.last;
        if (
          last &&
          last.turn === turn &&
          this.s.active(turn) &&
          this.s.state.sketch?.id === last.id
        )
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
        displayId: this.s.captures.find((c) => c.primary)?.display.id,
        done: sketch.done,
        elements: sketch.elements,
      },
    });
  };
}
