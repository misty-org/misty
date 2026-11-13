import { describe, expect, it } from "vitest";
import { spreadLabels, type Label } from "./spread";

const label = (id: string, x: number, y: number, more: Partial<Label> = {}): Label => ({
  id,
  x,
  y,
  w: 80,
  h: 20,
  priority: 2,
  ...more,
});

describe("spreadLabels", () => {
  it("leaves labels that don't touch where they are", () => {
    const placed = spreadLabels([label("a", 0, 0), label("b", 200, 0)]);
    expect(placed.get("a")).toEqual({ dy: 0, hidden: false });
    expect(placed.get("b")).toEqual({ dy: 0, hidden: false });
  });

  it("pushes the later of two overlapping names down below the first", () => {
    const placed = spreadLabels([label("a", 0, 0), label("b", 10, 4)]);
    expect(placed.get("a")!.dy).toBe(0);
    expect(placed.get("b")!.dy).toBeGreaterThanOrEqual(19);
  });

  it("places the one that matters most first, wherever it is in the list", () => {
    const placed = spreadLabels([label("rest", 0, 0), label("needs", 0, 2, { priority: 1 })]);
    expect(placed.get("needs")!.dy).toBe(0);
    expect(placed.get("rest")!.dy).toBeGreaterThan(0);
  });

  it("stacks labels over heads upward", () => {
    const placed = spreadLabels([
      label("a", 0, 100, { up: true }),
      label("b", 0, 100, { up: true }),
    ]);
    expect(placed.get("b")!.dy).toBeLessThan(0);
  });

  it("hides a label that would go too far, but never the picked one", () => {
    const crowd = Array.from({ length: 8 }, (_, index) => label(`n${index}`, 0, 0));
    const placed = spreadLabels([...crowd, label("picked", 0, 0, { priority: 0 })]);
    expect(placed.get("picked")).toEqual({ dy: 0, hidden: false });
    expect([...placed.values()].some((item) => item.hidden)).toBe(true);
  });
});
