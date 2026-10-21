import { describe, expect, it } from "vitest";

import { opaqueColorHex } from "./opaqueColorHex";

describe("opaqueColorHex", () => {
  it("reads rgb() and a Space wash's color(srgb …)", () => {
    expect(opaqueColorHex("rgb", "15, 15, 15")).toBe("#0f0f0f");
    expect(opaqueColorHex("color", "srgb 0.2 0.1 0.0588")).toBe("#331a0f");
    expect(opaqueColorHex("color", "srgb 50% 0% 100%")).toBe("#8000ff");
  });

  it("skips translucent colors and other color spaces", () => {
    expect(opaqueColorHex("rgba", "0, 0, 0, 0.5")).toBeUndefined();
    expect(opaqueColorHex("color", "srgb 0.2 0.1 0.1 / 0.5")).toBeUndefined();
    expect(opaqueColorHex("color", "display-p3 0.2 0.1 0.1")).toBeUndefined();
  });
});
