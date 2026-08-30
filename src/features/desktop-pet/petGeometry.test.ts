import { describe, expect, it } from "vitest";
import { centeredSurfacePosition } from "./petGeometry";

describe("centeredSurfacePosition", () => {
  it("keeps an expanded panel centered on the pet", () => {
    expect(
      centeredSurfacePosition(
        { x: 500, y: 300 },
        { width: 164, height: 164 },
        { width: 808, height: 132 },
      ),
    ).toEqual({ x: 178, y: 316 });
  });

  it("keeps the centered panel inside the current work area", () => {
    expect(
      centeredSurfacePosition(
        { x: 1800, y: 980 },
        { width: 164, height: 164 },
        { width: 808, height: 672 },
        { left: 0, top: 24, right: 1920, bottom: 1080, width: 1920, height: 1056 },
        14,
      ),
    ).toEqual({ x: 1098, y: 394 });
  });
});
