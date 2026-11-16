import type { StudioEmote } from "../studioOrders";

/**
 * Where the arms go while a figure acts something out: `side` 0 is its right arm, and `age` the
 * seconds since it began. Returns the arm's swing forward and its lift out to the side.
 */
export function emotePose(
  kind: StudioEmote,
  side: number,
  age: number,
  lift: number,
  out: number,
): [number, number] {
  const sign = side ? -1 : 1;
  switch (kind) {
    case "wave":
      return side === 0 ? [0, 2.55 + Math.sin(age * 9) * 0.32] : [lift, out];
    case "cheer":
      return [0, sign * (2.7 + Math.sin(age * 12) * 0.15)];
    case "dance":
      return [Math.sin(age * 6 + side * Math.PI) * 1.2 - 0.6, sign * 0.5];
    case "clap":
      return [-1.3, sign * (0.32 + Math.abs(Math.sin(age * 9)) * 0.3)];
    case "think":
      return side === 1 ? [-2.3, -0.5] : [-0.5, 0.25];
    case "point":
      return side === 0 ? [-1.55, 0.1] : [lift, out];
  }
}
