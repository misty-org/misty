import { describe, expect, it } from "vitest";
import { applyTextEdits } from "./workspaceEdits";

describe("workspace edit application", () => {
  it("applies cross-line edits against the original coordinate space", () => {
    expect(
      applyTextEdits("const old = old;\n", [
        {
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
          newText: "next",
        },
        {
          range: { start: { line: 0, character: 12 }, end: { line: 0, character: 15 } },
          newText: "next",
        },
      ]),
    ).toBe("const next = next;\n");
  });
});
