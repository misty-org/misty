import { cams, compareCams, frameExtras, moves, type Placement } from "./director";
import type { Point, Resolve, Target } from "./motion";

// Cursor and camera targets name DOM elements ("laptop:rail-sync"). Before
// playback, each target is measured once at the moment it is used, relative
// to its window and independent of camera transforms. Paths then read this
// cache, so seeking renders identically to playing.

type Rect = { x: number; y: number; w: number; h: number };
const cache = new Map<string, Rect>();
const key = (at: number, target: string) => `${at.toFixed(3)}|${target}`;

export function measurementRequests() {
  // `render` is when the DOM is read: a click changes the UI at its own
  // instant, so its target is read just before it lands.
  const requests: { at: number; target: string; render?: number }[] = [];
  for (const move of moves)
    if (typeof move.to === "string") requests.push({ at: move.at, target: move.to, render: move.click ? move.at - 0.03 : move.at });
  for (const cam of cams) if (typeof cam.at === "string") requests.push({ at: cam.t, target: cam.at });
  for (const callout of frameExtras(0).callouts) requests.push({ at: callout.at, target: callout.target });
  for (const cam of [...compareCams.desktop, ...compareCams.laptop])
    if (typeof cam.at === "string") requests.push({ at: cam.t, target: cam.at });
  return requests;
}

export function measure(at: number, target: string, root: ParentNode = document) {
  const [win, id] = target.split(":");
  const windowElement = root.querySelector<HTMLElement>(`[data-window="${win}"]`);
  const element = windowElement?.querySelector<HTMLElement>(`[data-t="${CSS.escape(id)}"]`);
  if (!windowElement || !element) {
    console.warn(`Film target missing at ${at}s: ${target}`);
    return;
  }
  const frame = windowElement.getBoundingClientRect();
  const scale = frame.width / windowElement.offsetWidth;
  const rect = element.getBoundingClientRect();
  cache.set(key(at, target), {
    x: (rect.left - frame.left) / scale,
    y: (rect.top - frame.top) / scale,
    w: rect.width / scale,
    h: rect.height / scale,
  });
}

export const missing = (at: number, target: string) => !cache.has(key(at, target));

/** A target point in its window's own coordinates. */
export function local(target: Target, at: number, anchor: Point = { x: 0.5, y: 0.5 }): Point {
  if (Array.isArray(target)) return { x: target[0], y: target[1] };
  const rect = cache.get(key(at, target));
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.x + rect.w * anchor.x, y: rect.y + rect.h * anchor.y };
}

/** World coordinates, using where each window sits in the current frame. */
export function worldResolver(placements: Placement[]): Resolve {
  return (target, at, anchor) => {
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    const place = placements.find((item) => item.id === target.split(":")[0]);
    const point = local(target, at, anchor);
    return place ? { x: place.x + point.x, y: place.y + point.y } : point;
  };
}
