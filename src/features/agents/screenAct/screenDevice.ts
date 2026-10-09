import type { AbstractInterface, DeviceAction } from "@midscene/core/device";
import { screenActionSpace } from "./screenActions";
import type { PlannedAction, ScreenSurface, SurfaceAdapter } from "./screenActSurface";

/** One fresh capture of the screen the agent is acting in. */
export interface ScreenFrame {
  documentId: string;
  image: { dataUrl: string; width: number; height: number };
}

export type ScreenExecute = <T>(operation: string, input: Record<string, unknown>) => Promise<T>;

/** Why the device ended the goal itself, rather than the planner. */
export interface ScreenStop {
  status: "needs_confirmation" | "incomplete";
  summary: string;
}

// Actions in a row after which an unchanged screenshot ends the goal.
const unchangedLimit = 3;
// Time for the page to react before the next frame is planned on.
const settleMs = 350;
const pollMs = 500;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * The screen a Midscene Agent drives: a browser page, the Misty window or the
 * desktop. Every capture and input goes through Misty's native operations
 * under the job's grant, so leases, Stop and takeover apply to each action.
 * Waiting reuses the live capture and costs no model calls.
 */
// Implemented, not extended: the base class only declares optional hooks.
export class MistyScreenDevice implements AbstractInterface {
  // Midscene demands an element-locating model family for every other device
  // type. These actions carry their own coordinates, so any vision model plans.
  interfaceType = "static";
  frame?: ScreenFrame;
  cursor?: { x: number; y: number };
  actions: string[] = [];
  dispatched = false;
  stop?: ScreenStop;
  failure?: unknown;
  private planned = false;
  private unchanged = 0;
  private readonly space: DeviceAction[];

  constructor(
    private readonly options: {
      surface: ScreenSurface;
      adapter: SurfaceAdapter;
      execute: ScreenExecute;
      allowConsequential: boolean;
      /** Aborting it ends the goal; the device aborts it to stop or fail. */
      controller: AbortController;
    },
  ) {
    this.space = screenActionSpace(options.surface, {
      act: (action, plan) => this.act(action, plan),
      waitForChange: (seconds) => this.waitForChange(seconds),
    });
  }

  actionSpace() {
    return this.space;
  }

  describe() {
    return `Misty ${this.options.surface} screen`;
  }

  // Midscene asks for the size, then the screenshot, of each frame it plans on.
  async size() {
    if (!this.planned || !this.frame) await this.capture();
    this.planned = true;
    return { width: this.frame!.image.width, height: this.frame!.image.height };
  }

  async screenshotBase64() {
    if (!this.planned || !this.frame) await this.capture();
    this.planned = false;
    return this.frame!.image.dataUrl;
  }

  private get signal() {
    return this.options.controller.signal;
  }

  private end(stop: ScreenStop): never {
    this.stop = stop;
    this.options.controller.abort(new Error(stop.summary));
    throw new Error(stop.summary);
  }

  private async device<T>(operation: string, input: Record<string, unknown>) {
    this.signal.throwIfAborted();
    try {
      return await this.options.execute<T>(operation, input);
    } catch (error) {
      if (/browser_snapshot_stale/.test(String((error as Error)?.message ?? error))) throw error;
      // A closed screen, revoked grant or Stop cannot recover by replanning.
      this.failure = error;
      this.options.controller.abort(error);
      throw error;
    }
  }

  private async capture() {
    const frame = await this.device<ScreenFrame>(this.options.adapter.visual, {});
    if (!frame?.documentId || !frame.image?.dataUrl) {
      this.failure = new Error("The screen did not return a usable screenshot.");
      this.options.controller.abort(this.failure);
      throw this.failure;
    }
    this.frame = frame;
    return frame;
  }

  private async act(action: PlannedAction, plan: { consequential: boolean; description: string }) {
    if (plan.consequential && !this.options.allowConsequential)
      this.end({
        status: "needs_confirmation",
        summary: `Stopped before a consequential action: ${plan.description}. Ask the user, then call again with allowConsequential if they agree.`,
      });
    const before = this.frame ?? (await this.capture());
    const mapped = this.options.adapter.input(action, {
      documentId: before.documentId,
      consequential: plan.consequential,
      description: plan.description,
    });
    if ("unsupported" in mapped) return mapped.unsupported;
    let result: { cursor?: { x: number; y: number } } | undefined;
    try {
      this.dispatched = true;
      result = await this.device(this.options.adapter.interact, mapped.input);
    } catch (error) {
      if (this.failure) throw error;
      // The page moved under a stale frame; plan again on a fresh one.
      await this.capture();
      this.planned = true;
      return `The page changed before "${plan.description}" landed. Look at the new screenshot and try again.`;
    }
    this.actions.push(plan.description);
    this.cursor = result?.cursor ?? this.options.adapter.cursor(action) ?? this.cursor;
    await sleep(settleMs, this.signal);
    const after = await this.capture();
    this.planned = true;
    if (after.image.dataUrl !== before.image.dataUrl) {
      this.unchanged = 0;
      const at = this.cursor
        ? ` Cursor now at (${this.cursor.x.toFixed(3)}, ${this.cursor.y.toFixed(3)}).`
        : "";
      return `${plan.description}: done.${at}`;
    }
    if (++this.unchanged >= unchangedLimit)
      this.end({
        status: "incomplete",
        summary: `The screen did not respond after ${this.unchanged} tries at: ${plan.description}.`,
      });
    return `The screenshot did not change after "${plan.description}". Try something different, wait for the screen, or report that you cannot finish.`;
  }

  private async waitForChange(timeoutSeconds: number) {
    const started = Date.now();
    const base = (this.frame ?? (await this.capture())).image.dataUrl;
    let changed = false;
    while (Date.now() - started < timeoutSeconds * 1000) {
      await sleep(pollMs, this.signal);
      if ((await this.capture()).image.dataUrl !== base) {
        changed = true;
        break;
      }
    }
    // Let moves and animations finish before planning on the frame.
    for (let i = 0; changed && i < 8; i++) {
      const previous = this.frame!.image.dataUrl;
      await sleep(pollMs, this.signal);
      if ((await this.capture()).image.dataUrl === previous) break;
    }
    this.planned = true;
    this.unchanged = 0;
    const seconds = Math.round((Date.now() - started) / 1000);
    return changed
      ? `The screen changed after ${seconds}s and has settled.`
      : `The screen did not change in ${seconds}s.`;
  }
}
