import type { Point } from "./motion";

const IDLE_MS = 3000;
const TYPING_PAUSE_MS = 600;
const WAKE_DISTANCE = 10;

/** Transient presentation state; never changes the user's companion preference. */
export class CompanionActivity {
  private anchor?: Point;
  private lastMovement = 0;
  private lastTyping = -Infinity;
  private keyboardActivity?: number;
  private awaitingMovement = false;

  sample(point: Point, keyboardActivity: number | undefined, now: number) {
    if (!this.anchor) {
      this.anchor = { ...point };
      this.lastMovement = now;
    }
    if (keyboardActivity !== undefined) {
      if (this.keyboardActivity !== undefined && keyboardActivity !== this.keyboardActivity) {
        this.lastTyping = now;
        this.awaitingMovement = true;
      }
      this.keyboardActivity = keyboardActivity;
    }
    // Movement during typing cannot cause a delayed reappearance when typing stops.
    if (now - this.lastTyping < TYPING_PAUSE_MS) {
      this.anchor = { ...point };
    } else if (Math.hypot(point.x - this.anchor.x, point.y - this.anchor.y) >= WAKE_DISTANCE) {
      this.anchor = { ...point };
      this.lastMovement = now;
      this.awaitingMovement = false;
    }
  }

  presentation(now: number, engaged: boolean) {
    if (engaged) this.lastMovement = now;
    return {
      visible: engaged || (!this.awaitingMovement && now - this.lastMovement < IDLE_MS),
      fadeMs: !engaged && this.awaitingMovement ? 150 : 400,
    };
  }
}
