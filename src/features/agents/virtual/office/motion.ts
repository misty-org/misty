import type { Point } from "./grid";

/** A figure on the move: where it is, which way it looks, and the places still ahead of it. */
export interface Walker extends Point {
  yaw: number;
  path: Point[];
  /** Distance walked, which drives the swing of the legs. */
  stride: number;
  moving: boolean;
}

export const createWalker = (at: Point, yaw: number): Walker => ({
  x: at.x,
  z: at.z,
  yaw,
  path: [],
  stride: 0,
  moving: false,
});

/** Turn toward an angle by at most `step`, the short way round. */
export function turnToward(yaw: number, target: number, step: number): number {
  const full = Math.PI * 2;
  const gap = ((((target - yaw) % full) + full + Math.PI) % full) - Math.PI;
  return Math.abs(gap) <= step ? target : yaw + Math.sign(gap) * step;
}

/** Walk along the path for `seconds` at `speed`, turning to face the way it goes. */
export function advanceWalker(walker: Walker, seconds: number, speed: number): void {
  let left = speed * seconds;
  while (left > 0 && walker.path.length) {
    const next = walker.path[0]!;
    const gap = Math.hypot(next.x - walker.x, next.z - walker.z);
    if (gap > 1e-4) {
      const heading = Math.atan2(next.x - walker.x, next.z - walker.z);
      walker.yaw = turnToward(walker.yaw, heading, seconds * 10);
    }
    if (gap <= left) {
      walker.x = next.x;
      walker.z = next.z;
      walker.path.shift();
      walker.stride += gap;
      left -= gap;
    } else {
      walker.x += ((next.x - walker.x) / gap) * left;
      walker.z += ((next.z - walker.z) / gap) * left;
      walker.stride += left;
      left = 0;
    }
  }
  walker.moving = walker.path.length > 0;
}

/** Put the walker at the end of its path at once, for people who asked for less motion. */
export function finishWalk(walker: Walker): void {
  const last = walker.path[walker.path.length - 1];
  if (last) [walker.x, walker.z] = [last.x, last.z];
  walker.path = [];
  walker.moving = false;
}
