import { expect, it } from "vitest";
import { companionFollowPoint, normalizeCompanionSize } from "./companionSize";
it("keeps every supported size on-screen while following beside the cursor", () => {
  for (const size of [50, 100, 150, 200]) {
    const radius = (16 * size) / 100;
    for (const mouse of [
      { x: 0, y: 0 },
      { x: 799, y: 679 },
      { x: 799, y: 0 },
      { x: 0, y: 679 },
    ]) {
      const p = companionFollowPoint(mouse, 800, 680, size);
      expect(p.x - radius).toBeGreaterThanOrEqual(0);
      expect(p.y - radius).toBeGreaterThanOrEqual(0);
      expect(p.x + radius).toBeLessThanOrEqual(800);
      expect(p.y + radius).toBeLessThanOrEqual(680);
    }
  }
  expect(companionFollowPoint({ x: 200, y: 300 }, 800, 680, 100)).toEqual({ x: 235, y: 325 });
});
it("sanitizes persisted size values", () => {
  for (const value of [undefined, null, "200", NaN, Infinity])
    expect(normalizeCompanionSize(value)).toBe(100);
  expect(normalizeCompanionSize(-5)).toBe(50);
  expect(normalizeCompanionSize(500)).toBe(200);
  expect(normalizeCompanionSize(124)).toBe(125);
});
