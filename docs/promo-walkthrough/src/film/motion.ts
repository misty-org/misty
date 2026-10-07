import { easeInOut, lerp } from "./time";

// Camera and cursor paths. Targets are "<window>:<data-t>" strings resolved to
// world coordinates through the measurement cache (see measure.ts), or raw
// world points.

export type Point = { x: number; y: number };
export type Target = string | [number, number];
export type Resolve = (target: Target, at: number, anchor?: Point) => Point;

export type Cam = { x: number; y: number; zoom: number };
export type CamKey = { t: number; at: Target; zoom: number; dx?: number; dy?: number };

export function camAt(keys: CamKey[], t: number, resolve: Resolve): Cam {
  const point = (key: CamKey) => {
    const p = resolve(key.at, key.t);
    return { x: p.x + (key.dx ?? 0), y: p.y + (key.dy ?? 0), zoom: key.zoom };
  };
  if (t <= keys[0].t) return point(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t < b.t) {
      const k = easeInOut((t - a.t) / (b.t - a.t));
      const pa = point(a);
      const pb = point(b);
      // Zoom moves geometrically so pushes in and out feel even.
      return { x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k), zoom: Math.exp(lerp(Math.log(pa.zoom), Math.log(pb.zoom), k)) };
    }
  }
  return point(keys[keys.length - 1]);
}

export type Move = {
  /** Arrival time; a click, if any, lands here. */
  at: number;
  to: Target;
  /** Travel time before arrival. */
  dur?: number;
  click?: boolean;
  /** Anchor within the target box, 0–1 on each axis. */
  anchor?: Point;
};

export type CursorFrame = { x: number; y: number; press: number; ripple: number | null };

export function cursorAt(moves: Move[], t: number, resolve: Resolve): CursorFrame | null {
  if (!moves.length || t < moves[0].at - (moves[0].dur ?? 0.6)) return null;
  let index = moves.findIndex((move) => move.at > t);
  if (index === -1) index = moves.length;
  const last = moves[Math.max(0, index - 1)];
  const next = moves[index];
  const end = resolve(last.to, last.at, last.anchor);
  let point = end;
  if (next) {
    const dur = next.dur ?? 0.6;
    const start = next.at - dur;
    if (t >= start) {
      const k = dur <= 0 ? 1 : easeInOut((t - start) / dur);
      const to = resolve(next.to, next.at, next.anchor);
      // A slight arc reads as a hand moving rather than a straight slide.
      const arc = Math.sin(Math.PI * k) * Math.min(40, Math.hypot(to.x - end.x, to.y - end.y) * 0.08);
      point = { x: lerp(end.x, to.x, k), y: lerp(end.y, to.y, k) - arc };
    }
  }
  const clicked = [...moves].reverse().find((move) => move.click && move.at <= t);
  const age = clicked ? t - clicked.at : Infinity;
  return { ...point, press: age < 0.14 ? 1 : 0, ripple: age < 0.45 ? age / 0.45 : null };
}

export const clickTimes = (moves: Move[]) => moves.filter((move) => move.click).map((move) => move.at);
