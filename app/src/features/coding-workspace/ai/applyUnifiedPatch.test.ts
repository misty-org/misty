import { describe, expect, it } from "vitest";
import { applyUnifiedPatch } from "./applyUnifiedPatch";

describe("applyUnifiedPatch", () => {
  it("applies a revision-matched hunk and leaves the result unsaved", () => {
    expect(
      applyUnifiedPatch(
        "const answer = 41;\nconsole.log(answer);\n",
        "--- a/example.ts\n+++ b/example.ts\n@@ -1,2 +1,2 @@\n-const answer = 41;\n+const answer = 42;\n console.log(answer);",
      ),
    ).toBe("const answer = 42;\nconsole.log(answer);\n");
  });

  it("rejects stale context", () => {
    expect(() => applyUnifiedPatch("changed\n", "@@ -1 +1 @@\n-old\n+new")).toThrow(/changed/i);
  });

  it("rejects content without a hunk", () => {
    expect(() => applyUnifiedPatch("old", "new")).toThrow(/unified diff/i);
  });
});
