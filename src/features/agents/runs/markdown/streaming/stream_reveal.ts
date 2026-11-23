// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
export interface RevealClock {
  now(): number;
  frame(callback: () => void): number;
  cancelFrame(id: number): void;
  timeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}
const browserClock: RevealClock = {
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  timeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export const REVEAL_MAX_LAG_MS = 240;
const MIN_LAG_MS = 80;
const MAX_HOLDBACK = 600;
const STALL_MS = 100;

function isReplacement(previous: string, next: string): boolean {
  if (!previous || !next) return false;
  const limit = Math.min(previous.length, next.length);
  let common = 0;
  while (common < limit && previous[common] === next[common]) common += 1;
  return common < Math.min(24, limit * 0.5);
}

export class StreamReveal {
  private text = "";
  private visible: number;
  private holdback = 0;
  private deadline = 0;
  private cadence = 80;
  private rate = 0;
  private lastArrival: number | undefined;
  private frame: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastTick = 0;
  private listeners = new Set<{ start: number; end: number; notify: () => void }>();
  private clock: RevealClock;
  constructor(live: boolean, clock: RevealClock = browserClock) {
    this.clock = clock;
    this.visible = live ? 0 : Infinity;
  }
  read(start: number, length: number) {
    return Math.max(0, Math.min(length, this.visible - start));
  }
  subscribe(start: number, length: number, notify: () => void) {
    const listener = { start, end: start + length, notify };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(next: number) {
    const previous = this.visible;
    this.visible = next;
    if (next === previous) return;
    for (const listener of this.listeners) {
      if (next < previous || (listener.end > previous && listener.start < next)) listener.notify();
    }
  }
  update(text: string, animate: boolean) {
    if (text === this.text) {
      if (!animate) {
        this.finish();
        return;
      }
      if (this.holdback > 0) this.run(this.clock.now());
      return;
    }
    const now = this.clock.now();
    const previous = this.text;
    this.text = text;
    if (!animate || this.visible === Infinity || isReplacement(previous, text)) {
      this.finish();
      return;
    }
    const gained = text.length - previous.length;
    this.holdback = Math.max(0, this.holdback + gained);
    if (this.holdback > MAX_HOLDBACK) {
      this.finish();
      return;
    }
    if (gained > 0 && this.lastArrival !== undefined) {
      const gap = now - this.lastArrival;
      if (gap >= 16) {
        this.cadence = this.cadence * 0.5 + Math.min(gap, 220) * 0.5;
        this.rate = this.rate > 0 ? this.rate * 0.5 + (gained / gap) * 0.5 : gained / gap;
      }
    }
    this.lastArrival = now;
    if (this.text.length < this.visible) this.publish(this.text.length);
    if (this.holdback <= 0) {
      this.cancel();
      return;
    }
    const spread =
      this.rate > 0 ? Math.max(this.cadence * 1.1, this.holdback / this.rate) : REVEAL_MAX_LAG_MS;
    this.deadline = now + Math.min(REVEAL_MAX_LAG_MS, Math.max(MIN_LAG_MS, spread));
    this.run(now);
  }
  private run(now: number) {
    if (this.frame === undefined) {
      this.lastTick = now;
      this.frame = this.clock.frame(() => this.tick());
    }
    if (this.timer === undefined) {
      const watchdog = () => {
        this.timer = undefined;
        const idle = this.clock.now() - this.lastTick;
        if (idle >= STALL_MS) {
          this.finish();
          return;
        }
        this.timer = this.clock.timeout(watchdog, STALL_MS - idle);
      };
      this.timer = this.clock.timeout(watchdog, STALL_MS);
    }
  }
  private tick() {
    this.frame = undefined;
    const now = this.clock.now();
    const remaining = this.deadline - now;
    if (this.holdback <= 0.5 || remaining <= 0) {
      this.holdback = 0;
      this.publish(this.text.length);
      this.cancel();
      return;
    }
    const dt = Math.max(0, Math.min(now - this.lastTick, remaining));
    this.lastTick = now;
    this.holdback = Math.max(0, this.holdback - (this.holdback * dt) / remaining);
    const target = this.text.length - Math.round(this.holdback);
    if (target > this.visible) this.publish(target);
    this.frame = this.clock.frame(() => this.tick());
  }
  finish() {
    this.cancel();
    this.holdback = 0;
    this.publish(this.text.length);
  }
  cancel() {
    if (this.frame !== undefined) this.clock.cancelFrame(this.frame);
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.frame = undefined;
    this.timer = undefined;
  }
}

interface GraphemeSegments extends Iterable<{ index: number; segment: string }> {
  containing(index: number): { index: number } | undefined;
}
type GraphemeSegmenter = new (
  locale?: string,
  options?: { granularity: "grapheme" },
) => { segment(text: string): GraphemeSegments };
export const GraphemeSegmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
const segmenter = GraphemeSegmenter
  ? new GraphemeSegmenter(undefined, { granularity: "grapheme" })
  : null;

export function createVisibleTextReader(text: string) {
  let segments: GraphemeSegments | undefined;
  const boundary = (count: number) => {
    if (count >= text.length) return text.length;
    if (count <= 0) return 0;
    segments ??= segmenter?.segment(text);
    return segments?.containing?.(count)?.index ?? text.length;
  };
  return {
    prefix: (count: number) => text.slice(0, boundary(count)),
    window(count: number, limit: number) {
      const end = boundary(count);
      if (end <= limit) return text.slice(0, end);
      const start = boundary(end - limit);
      return text.slice(start > end - limit ? 0 : start, end);
    },
    lineWindow(count: number, limit: number): { text: string; truncated: boolean } {
      const end = boundary(count);
      if (end <= limit) return { text: text.slice(0, end), truncated: false };
      const cut = end - limit;
      const newline = text.indexOf("\n", cut);
      const start = newline === -1 || newline >= end ? boundary(cut) : newline + 1;
      return { text: text.slice(start, end), truncated: true };
    },
  };
}
