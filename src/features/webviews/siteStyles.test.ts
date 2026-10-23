import { describe, expect, it } from "vitest";
import { readBoost, withBoost } from "./siteStyles";

describe("site boosts", () => {
  it("writes and reads a font and size, keeping other CSS", () => {
    const css = withBoost(".ad { display: none !important; }", { font: "Georgia, 'Times New Roman', serif", size: "112" });
    expect(css).toContain(".ad { display: none !important; }");
    expect(readBoost(css)).toEqual({ font: "Georgia, 'Times New Roman', serif", size: "112" });
  });

  it("removes the block when both are default", () => {
    const css = withBoost("a { color: red; }", { font: "system-ui, sans-serif", size: "" });
    expect(withBoost(css, { font: "", size: "" })).toBe("a { color: red; }");
  });
});
