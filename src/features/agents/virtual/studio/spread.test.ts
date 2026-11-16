import { describe, expect, it } from "vitest";
import { stackLabels, type Label } from "./spread";

const label = (id: string, x: number, y: number, more: Partial<Label> = {}): Label => ({
  id,
  x,
  y,
  w: 80,
  h: 20,
  priority: 2,
  ...more,
});

describe("stackLabels", () => {
  it("leaves different figures' labels where they are, even when they overlap", () => {
    const placed = stackLabels([label("a", 0, 0, { anchor: "a" }), label("b", 10, 4, { anchor: "b" })]);
    expect(placed.get("a")).toEqual({ dy: 0 });
    expect(placed.get("b")).toEqual({ dy: 0 });
  });

  it("puts what a figure says over its own name", () => {
    const placed = stackLabels([
      label("say", 0, 100, { up: true, anchor: "head", priority: 2.5 }),
      label("name", 0, 100, { up: true, anchor: "head", priority: 2 }),
    ]);
    expect(placed.get("name")!.dy).toBe(0);
    expect(placed.get("say")!.dy).toBe(-23);
  });
});
