import { describe, expect, it } from "vitest";
import { captureDataUrlByteLength, regionFromPoints } from "./MistyRegionCapture";

describe("Misty region capture", () => {
  it("normalizes a drag in every direction", () => {
    expect(regionFromPoints({ x: 80, y: 60 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 60,
      height: 50,
    });
  });

  it("measures padded capture payloads without counting the data URL prefix", () => {
    expect(captureDataUrlByteLength("data:image/jpeg;base64,AQIDBA==")).toBe(4);
    expect(captureDataUrlByteLength("data:image/jpeg;base64,AQID")).toBe(3);
  });
});
