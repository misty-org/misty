import { render, screen } from "@testing-library/react";
import { Folder, GitBranch } from "lucide-react";
import { describe, expect, it } from "vitest";
import { PathLine, pathLineLabelCap } from "./PathLine";

describe("pathLineLabelCap", () => {
  it("leaves the labels alone when they fit", () => {
    expect(pathLineLabelCap([40, 80, 120], 240)).toBeNull();
  });

  it("shortens the longest label first", () => {
    // 40 + 80 + 100 = 220: only the 120 label gives up 20.
    expect(pathLineLabelCap([40, 80, 120], 220)).toBe(100);
    // Once it reaches the next longest, both shorten together: 40 + 2 * 60 = 160.
    expect(pathLineLabelCap([40, 120, 80], 160)).toBe(60);
  });

  it("keeps every label a little visible", () => {
    expect(pathLineLabelCap([200, 200], 10)).toBe(24);
  });
});

describe("PathLine", () => {
  it("reads as one line of segments in order", () => {
    render(
      <PathLine
        label="Where this chat works"
        segments={[
          { label: "Design" },
          { icon: Folder, label: "misty" },
          { icon: GitBranch, label: "redesign/design-protocol" },
        ]}
      />,
    );
    const line = screen.getByRole("group", { name: "Where this chat works" });
    expect(line.textContent).toBe("Designmistyredesign/design-protocol");
    expect(line.className).toContain("text-meta");
    expect(line.className).not.toContain("font-mono");
  });
});
