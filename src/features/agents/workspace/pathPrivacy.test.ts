import { describe, expect, it } from "vitest";
import { agentServerContext, deviceRelativePath } from "./pathPrivacy";

describe("Agent path privacy", () => {
  it("sends an opaque scope and relative selected paths", () => {
    const context = agentServerContext(
      "/Users/alice/Private Reports",
      ["/Users/alice/Private Reports/2026/Q2.pdf", "/Users/alice/elsewhere.txt"],
      "scope_opaque",
    );
    expect(context).toEqual({ activeRoot: "scope_opaque", selectedPaths: ["2026/Q2.pdf"] });
    expect(JSON.stringify(context)).not.toContain("/Users/alice");
  });

  it("handles Windows roots without exposing the drive path", () => {
    expect(deviceRelativePath("C:\\Users\\Alice\\Docs", "c:\\users\\alice\\docs\\report.pdf")).toBe(
      "report.pdf",
    );
    expect(deviceRelativePath("C:\\Users\\Alice\\Docs", "D:\\report.pdf")).toBeNull();
  });
});
