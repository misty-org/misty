import { describe, expect, it } from "vitest";
import { commandCenterModeForInput, lineNumberForInput, rankFiles } from "./CodeCommandCenter";

describe("Code command-center input", () => {
  it.each([
    [">format", "commands"],
    ["/needle", "search"],
    [":42", "files"],
    ["main.ts", null],
  ])("routes %s to %s", (value, mode) => {
    expect(commandCenterModeForInput(value)).toBe(mode);
  });

  it("parses line jumps without accepting partial input", () => {
    expect(lineNumberForInput(":128")).toBe(128);
    expect(lineNumberForInput(" :7 ")).toBe(7);
    expect(lineNumberForInput(":line")).toBeNull();
  });

  it("fuzzy-ranks matching paths instead of truncating before filtering", () => {
    const files = [
      { path: "/repo/src/application.ts", relative: "src/application.ts", name: "application.ts" },
      { path: "/repo/tests/app.ts", relative: "tests/app.ts", name: "app.ts" },
      { path: "/repo/src/panel.tsx", relative: "src/panel.tsx", name: "panel.tsx" },
    ];

    expect(rankFiles(files, "spx").map((file) => file.relative)).toEqual(["src/panel.tsx"]);
    expect(rankFiles(files, "app")[0]?.relative).toBe("tests/app.ts");
  });
});
