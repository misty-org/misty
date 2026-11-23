import { invoke } from "@tauri-apps/api/core";
import type { PresentedPoint } from "./protocol";

const FRAME_SLACK = 10;
const POINT_RADIUS = 36;
export const GUIDE_WAIT_MS = 5 * 60_000;
export const GUIDE_SETTLE_MS = 900;
const LOGGED_STEPS = 15;

export interface Walkthrough {
  goal: string;
  done: string[];
}
const walkthroughs = new Map<string, Walkthrough>();

export function beginWalkthrough(conversationId: string, goal: string) {
  walkthroughs.set(conversationId, { goal: goal.trim().slice(0, 400), done: [] });
}

export function walkthroughStepDone(conversationId: string, point: PresentedPoint) {
  const log = walkthroughs.get(conversationId);
  if (!log || !point.guide) return;
  const label = point.label.trim() || "the step";
  log.done = [...log.done, `${point.guide.step}. ${label}`].slice(-LOGGED_STEPS);
}

export const walkthroughFor = (conversationId: string) => walkthroughs.get(conversationId);

export interface CompanionClick {
  turn: number;
  x: number;
  y: number;
}

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

export class CompanionGuideStep {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private done = false;

  constructor(
    readonly point: PresentedPoint,
    readonly turn: number,
    readonly conversationId: string,
    readonly voice: boolean,
    private readonly expire: () => void,
  ) {}

  start() {
    this.timer = setTimeout(() => {
      if (!this.done) this.expire();
    }, GUIDE_WAIT_MS);
    return invoke("cursor_companion_watch_clicks", { turn: this.turn, watching: true });
  }

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

export function nextStepPrompt(point: PresentedPoint, log?: Walkthrough) {
  const guide = point.guide!;
  const did = point.label.trim() ? ` (${point.label.trim()})` : "";
  const ask = `I did step ${guide.step} of ${guide.total}${did}. My screen is attached now; check it worked and show me the next step.`;
  if (!log?.goal) return ask;
  const done = log.done.length ? ` Done so far: ${log.done.join("; ")}.` : "";
  return (
    `${ask}\n\nWhat we're doing: ${log.goal}.${done} Don't give a step that's already done or ` +
    "send me back to a page I've already been through, unless the screen shows it didn't work. " +
    "If a step didn't work, say what went wrong and give another way instead of the same step."
  );
}
