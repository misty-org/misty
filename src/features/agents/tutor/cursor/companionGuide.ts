import { invoke } from "@tauri-apps/api/core";
import type { PresentedPoint } from "./protocol";

/** Extra room around a control's outline that still counts as clicking it. */
const FRAME_SLACK = 10;
/** Without a known outline, a click this close to the point counts. */
const POINT_RADIUS = 36;
/** A step nobody clicks stops waiting; "next" by voice or text still continues. */
export const GUIDE_WAIT_MS = 5 * 60_000;
/** How long after a step's click the screen is looked at again, so a page or menu it opened has loaded. */
export const GUIDE_SETTLE_MS = 900;
/** The steps a walkthrough's log keeps, the latest ones. */
const LOGGED_STEPS = 15;

/** What a walkthrough set out to do, and the steps done so far, by chat. */
export interface Walkthrough {
  goal: string;
  done: string[];
}
const walkthroughs = new Map<string, Walkthrough>();

/**
 * Starts a chat's walkthrough log at its first step: its goal is what the person asked. A
 * walkthrough that starts again (step 1 once more) starts a fresh log.
 */
export function beginWalkthrough(conversationId: string, goal: string) {
  walkthroughs.set(conversationId, { goal: goal.trim().slice(0, 400), done: [] });
}

/** Notes a finished step in the chat's walkthrough log. */
export function walkthroughStepDone(conversationId: string, point: PresentedPoint) {
  const log = walkthroughs.get(conversationId);
  if (!log || !point.guide) return;
  const label = point.label.trim() || "the step";
  log.done = [...log.done, `${point.guide.step}. ${label}`].slice(-LOGGED_STEPS);
}

/** The chat's walkthrough so far, if one is under way. */
export const walkthroughFor = (conversationId: string) => walkthroughs.get(conversationId);

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

/**
 * The continuation that asks for the next step with a fresh look at the screen. With the
 * walkthrough's log, it carries the goal and every step done, so a long walkthrough keeps its
 * place instead of looping back.
 */
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
