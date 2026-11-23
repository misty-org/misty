import type { AbstractInterface, DeviceAction } from "@midscene/core/device";
import { screenActionSpace } from "./screen_actions";
import type { PlannedAction, ScreenSurface, SurfaceAdapter } from "./screen_act_surface";

export interface ScreenFrame {
  documentId: string;
  image: { dataUrl: string; width: number; height: number };
}

type ScreenExecute = <T>(operation: string, input: Record<string, unknown>) => Promise<T>;

interface ScreenStop {
  status: "needs_confirmation" | "incomplete";
  summary: string;
}

const unchangedLimit = 3;
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

export class MistyScreenDevice implements AbstractInterface {
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
      const message = String((error as Error)?.message ?? error);
      if (/browser_snapshot_stale/.test(message)) throw error;
      const stopped = /browser_action_(?:declined|unconfirmed): (.*)/s.exec(message);
      if (stopped) this.end({ status: "needs_confirmation", summary: stopped[1]! });
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
      if (this.failure || this.stop) throw error;
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
