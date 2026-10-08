import { describe, expect, it } from "vitest";
import { pointBubbleText, pointLayout, POINT_RING_RADIUS } from "./pointLayout";
import type { PresentedPoint } from "./protocol";

const display = { x: 0, y: 0, width: 1440, height: 900 };
const at = (x: number, y: number, extra: Partial<PresentedPoint> = {}): PresentedPoint => ({
  x,
  y,
  displayId: 1,
  label: "click Commit",
  ...extra,
});

describe("pointLayout", () => {
  it("rings the exact spot and parks the companion beside it, never on it", () => {
    const { marker, companion } = pointLayout(at(400, 300), display, 1, 100);
    expect(marker).toEqual({
      x: 400 - POINT_RING_RADIUS,
      y: 300 - POINT_RING_RADIUS,
      width: POINT_RING_RADIUS * 2,
      height: POINT_RING_RADIUS * 2,
      ring: true,
    });
    // The 32px character's left edge stays clear of the ring.
    expect(companion.x - 16).toBeGreaterThan(marker.x + marker.width);
  });

  it("outlines a known control, in the display's own coordinates", () => {
    const secondary = { x: 1440, y: -200, width: 1920, height: 1080 };
    const point = at(1600, 0, { frame: { x: 1560, y: -12, width: 80, height: 24 } });
    const { marker } = pointLayout(point, secondary, 1, 100);
    expect(marker).toMatchObject({ x: 117, y: 185, width: 86, height: 30, ring: false });
  });

  it("flips to the other side at the display's right edge", () => {
    const { marker, companion } = pointLayout(at(1430, 450), display, 1, 100);
    expect(companion.x + 16).toBeLessThan(marker.x);
    expect(companion.x).toBeGreaterThanOrEqual(20);
  });

  it("converts physical pixels on Windows", () => {
    const { marker } = pointLayout(at(800, 600), { x: 0, y: 0, width: 2880, height: 1800 }, 2, 100);
    expect(marker.x + marker.width / 2).toBe(400);
    expect(marker.y + marker.height / 2).toBe(300);
  });
});

describe("pointBubbleText", () => {
  it("says what to do, with the step during a walkthrough", () => {
    expect(pointBubbleText(at(0, 0))).toBe("click Commit");
    expect(pointBubbleText(at(0, 0, { guide: { step: 2, total: 4 } }))).toBe(
      "2 of 4 · click Commit",
    );
    expect(pointBubbleText(at(0, 0, { label: " " }), () => 0)).toBe("right here!");
  });
});
