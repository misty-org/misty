// Ported from vendor/clicky/leanring-buddy/OverlayWindow.swift.
export interface Point {
  x: number;
  y: number;
}
export const FOLLOW_OFFSET = { x: 35, y: 25 };
export const POINT_HOLD_MS = 3000;
export const BUBBLE_FADE_MS = 500;
export function flight(from: Point, to: Point, elapsedMs: number) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = Math.max(600, Math.min(1400, (distance / 800) * 1000));
  const progress = Math.min(1, Math.max(0, elapsedMs / duration));
  const t = 3 * progress ** 2 - 2 * progress ** 3;
  const control = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - Math.min(distance * 0.2, 80) };
  const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x;
  const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y;
  const dx = 2 * (1 - t) * (control.x - from.x) + 2 * t * (to.x - control.x);
  const dy = 2 * (1 - t) * (control.y - from.y) + 2 * t * (to.y - control.y);
  return {
    x,
    y,
    scale: 1 + Math.sin(progress * Math.PI) * 0.3,
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI + 90,
    done: progress === 1,
  };
}
/** SwiftUI spring(response: .2, dampingFraction: .6), integrated in bounded substeps. */
export function spring(
  position: Point,
  velocity: Point,
  target: Point,
  seconds: number,
  response = 0.2,
) {
  const omega = (2 * Math.PI) / response;
  let left = Math.min(seconds, 0.1);
  while (left > 0) {
    const dt = Math.min(left, 1 / 240);
    left -= dt;
    for (const axis of ["x", "y"] as const) {
      velocity[axis] +=
        (omega ** 2 * (target[axis] - position[axis]) - 2 * 0.6 * omega * velocity[axis]) * dt;
      position[axis] += velocity[axis] * dt;
    }
  }
}

/** Clicky's RMS gain/decay and five-bar profile; independent of microphone sample rate. */
export function recordingPower(rms: number, previous: number) {
  return Math.max(Math.min(Math.max(rms * 10.2, 0), 1), previous * 0.72);
}
export function waveformHeight(power: number, index: number, seconds: number) {
  const profile = [0.4, 0.7, 1, 0.7, 0.4];
  const eased = Math.min(Math.max(power - 0.008, 0) * 2.85, 1) ** 0.76;
  return 3 + eased * 10 * profile[index] + ((Math.sin(seconds * 3.6 + index * 0.35) + 1) / 2) * 1.5;
}
