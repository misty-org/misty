import { describe, expect, it } from "vitest";
import { canonicalStickerId, findStickers, stickerById } from "./stickerCatalog";
import { prepareStickers, sizedSvg, stickersMissing } from "./stickers";
import type { Mark } from "./imageEdit";

describe("OpenCut's stickers", () => {
  it("knows its shapes and flags by OpenCut's ids", () => {
    expect(findStickers("shapes", "").map((sticker) => sticker.id)).toEqual([
      "shapes:rectangle",
      "shapes:ellipse",
      "shapes:polygon",
      "shapes:star",
    ]);
    expect(stickerById("flags:FR")?.name).toBe("France");
    expect(canonicalStickerId("flags:fr")).toBe("flags:FR");
    expect(canonicalStickerId("Flags:jp")).toBe("flags:JP");
    expect(canonicalStickerId("shapes:blob")).toBeNull();
    expect(canonicalStickerId("logos:misty")).toBeNull();
    expect(canonicalStickerId(42)).toBeNull();
  });

  it("finds stickers by name, code or keyword", () => {
    expect(findStickers("flags", "japan").map((sticker) => sticker.id)).toEqual(["flags:JP"]);
    expect(findStickers("shapes", "box").map((sticker) => sticker.id)).toEqual([
      "shapes:rectangle",
    ]);
  });

  it("writes a size on a flag that gives only a viewBox, so WebKit can draw it", () => {
    expect(sizedSvg('<svg xmlns="x" viewBox="0 0 640 480"><path/></svg>')).toBe(
      '<svg width="640" height="480" xmlns="x" viewBox="0 0 640 480"><path/></svg>',
    );
    const sized = '<svg width="10" height="5" viewBox="0 0 640 480"></svg>';
    expect(sizedSvg(sized)).toBe(sized);
  });

  it("counts a flag as missing until it has loaded, and shapes never", async () => {
    const marks: Record<string, Mark> = {
      a: {
        id: "a",
        kind: "sticker",
        z: 1,
        color: "#ff3b30",
        size: 0.006,
        box: { x: 0, y: 0, width: 0.1, height: 0.1 },
        sticker: "shapes:star",
        opacity: 1,
      },
    };
    expect(stickersMissing(marks)).toEqual([]);
    await expect(prepareStickers(marks)).resolves.toBeUndefined();
    marks.b = { ...(marks.a as Extract<Mark, { kind: "sticker" }>), id: "b", sticker: "flags:FR" };
    expect(stickersMissing(marks)).toEqual(["flags:FR"]);
  });
});
