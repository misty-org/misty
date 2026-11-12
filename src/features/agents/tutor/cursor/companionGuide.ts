import { invoke } from "@tauri-apps/api/core";
import type { PresentedPoint } from "./protocol";

/** Extra room around a control's outline that still counts as clicking it. */
const FRAME_SLACK = 10;
/** Without a known outline, a click this close to the point counts. */
const POINT_RADIUS = 36;
/** A step nobody clicks stops waiting; "next" by voice or text still continues. */
export const GUIDE_WAIT_MS = 5 * 60_000;

export interface CompanionClick {
  turn: number;
  x: number;
  y: number;
}

/** Whether a click landed on the control a walkthrough step points at. */
export function clickHitsPoint(point: PresentedPoint, click: Pick<CompanionClick, "x" | "y">) {
  const frame = point.frame;
  if (frame)
    return (
      click.x >= frame.x - FRAME_SLACK &&
      click.x <= frame.x + frame.width + FRAME_SLACK &&
      click.y >= frame.y - FRAME_SLACK &&
      click.y <= frame.y + frame.height + FRAME_SLACK
    );
  return Math.hypot(click.x - point.x, click.y - point.y) <= POINT_RADIUS;
}

/**
 * One walkthrough step waiting for the person's click. Click positions leave
 * the native hook only while a step waits, and only for the companion's turn.
 */
export class CompanionGuideStep {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private done = false;

  constructor(
    readonly point: PresentedPoint,
    readonly turn: number,
    readonly conversationId: string,
    /** Narrate the next step: the walkthrough began as a spoken question. */
    readonly voice: boolean,
    private readonly expire: () => void,
  ) {}

  start() {
    this.timer = setTimeout(() => {
      if (!this.done) this.expire();
    }, GUIDE_WAIT_MS);
    return invoke("cursor_companion_watch_clicks", { turn: this.turn, watching: true });
  }

  /** True once, for the first click on the target during this step. */
  accepts(click: CompanionClick) {
    if (this.done || click.turn !== this.turn || !clickHitsPoint(this.point, click)) return false;
    this.stop();
    return true;
  }

  stop() {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    void invoke("cursor_companion_watch_clicks", { turn: this.turn, watching: false }).catch(
      () => {},
    );
  }
}

/** The continuation that asks for the next step with a fresh look at the screen. */
export function nextStepPrompt(point: PresentedPoint) {
  const guide = point.guide!;
  const did = point.label.trim() ? ` (${point.label.trim()})` : "";
  return `I did step ${guide.step} of ${guide.total}${did}. My screen is attached now; check it worked and show me the next step.`;
}
