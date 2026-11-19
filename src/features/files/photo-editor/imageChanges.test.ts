import { describe, expect, it } from "vitest";
import { applyImageChanges, ImageChangeRejected } from "./imageChanges";
import { cropFrame, defaultImageEdit, normalizeMark, type Mark } from "./imageEdit";

const author = "Agent";
const apply = (changes: Record<string, unknown>, natural = { width: 400, height: 300 }) =>
  applyImageChanges(defaultImageEdit, changes, { author, natural });

describe("an edit's checked changes", () => {
  it("sets light, color and the filter, and turns the crop with the image", () => {
    const next = apply({
      adjust: { exposure: 20.4, contrast: -10 },
      filter: "warm",
      filter_strength: 60,
      rotate: "right",
    });
    expect(next.adjust.exposure).toBe(20);
    expect(next.adjust.contrast).toBe(-10);
    expect(next.filter).toBe("warm");
    expect(next.filterStrength).toBe(60);
    expect(next.rotation).toBe(90);
  });

  it("crops to an aspect given alone, centered, as picking it does", () => {
    const next = apply({ aspect: "square" });
    expect(next.aspect).toBe("square");
    // 400 × 300: a square is three quarters of the width, in the middle.
    expect(next.crop.width).toBeCloseTo(0.75);
    expect(next.crop.height).toBeCloseTo(1);
    expect(next.crop.x).toBeCloseTo(0.125);
    // A crop given with it is kept as given.
    const given = apply({ aspect: "square", crop: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    expect(given.crop).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
  });

  it("adds marks, stickers among them, by the ids Misty has", () => {
    const next = apply({
      add_marks: [
        { kind: "arrow", from: { x: 0.1, y: 0.1 }, to: { x: 0.3, y: 0.2 } },
        { kind: "sticker", sticker: "flags:fr", box: { x: 0.2, y: 0.2, width: 0.2, height: 0.15 } },
      ],
    });
    const marks = Object.values(next.marks).sort((a, b) => a.z - b.z);
    expect(marks.map((mark) => mark.kind)).toEqual(["arrow", "sticker"]);
    expect(marks[1]).toMatchObject({ sticker: "flags:FR", opacity: 1, author });
  });

  it("refuses what doesn't fit, whole, saying what was wrong", () => {
    const refusal = (changes: Record<string, unknown>) => {
      try {
        apply(changes);
      } catch (error) {
        expect(error).toBeInstanceOf(ImageChangeRejected);
        return (error as Error).message;
      }
      throw new Error("not refused");
    };
    expect(refusal({ adjust: { glow: 10 } })).toContain("adjust.glow");
    expect(refusal({ adjust: { exposure: 300 } })).toContain("-100 to 100");
    expect(refusal({ rotation: 90 })).toContain("rotation");
    expect(refusal({ filter: "sepia" })).toContain("filter");
    const box = { x: 0, y: 0, width: 1, height: 1 };
    expect(refusal({ add_marks: [{ kind: "sticker", sticker: "logos:misty", box }] })).toContain(
      "sticker Misty has",
    );
  });

  it("leaves alone the fields its caller reads itself", () => {
    const next = applyImageChanges(
      defaultImageEdit,
      { item_id: "p1", space: "s1", flip: "horizontal" },
      { author, ignore: ["item_id", "space"] },
    );
    expect(next.flipX).toBe(true);
  });
});

describe("sticker marks", () => {
  it("are checked like any mark: only known stickers, a box, an opacity in range", () => {
    const sticker = (fields: Record<string, unknown>) =>
      normalizeMark({
        id: "m",
        kind: "sticker",
        z: 1,
        color: "#ffffff",
        size: 0.006,
        box: { x: 0.5, y: 0.5, width: -0.2, height: 0.2 },
        sticker: "shapes:star",
        opacity: 3,
        ...fields,
      } as unknown as Mark);
    expect(sticker({})).toMatchObject({
      box: { x: 0.3, y: 0.5, width: 0.2, height: 0.2 },
      opacity: 1,
    });
    expect(sticker({ sticker: "shapes:blob" })).toBeNull();
    expect(sticker({ box: { x: 0, y: 0, width: 0, height: 0.1 } })).toBeNull();
  });
});

describe("the crop's frame", () => {
  it("finds the middle of what shows, turned or not", () => {
    const natural = { width: 400, height: 300 };
    expect(cropFrame(defaultImageEdit, natural).center).toEqual({ x: 0.5, y: 0.375 });
    const turned = cropFrame({ ...defaultImageEdit, rotation: 90 }, natural);
    expect(turned.center.x).toBeCloseTo(0.5);
    expect(turned.center.y).toBeCloseTo(0.375);
    const left = cropFrame(
      { ...defaultImageEdit, crop: { x: 0, y: 0, width: 0.5, height: 1 } },
      natural,
    );
    expect(left.center.x).toBeCloseTo(0.25);
    expect(left.short).toBeCloseTo(0.5);
  });
});
