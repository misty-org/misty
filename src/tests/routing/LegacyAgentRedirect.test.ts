import { describe, expect, it } from "vitest";
import { legacyAgentDestination } from "@/routing/LegacyAgentRedirect";

describe("legacyAgentDestination", () => {
  it("returns legacy Agents entry points to the teammate-first Spaces mode", () => {
    expect(legacyAgentDestination("?path=%2Ftmp%2Fwork&paths=a%2Cb")).toBe("/spaces");
  });

  it("preserves a requested Space context", () => {
    expect(
      legacyAgentDestination(
        "?spaceId=space%2Fone&path=%2Fprivate&paths=secret",
        new Set(["space/one"]),
      ),
    ).toBe("/spaces/space%2Fone/chat?path=%2Fprivate&paths=secret&agentDock=1");
  });

  it("does not carry an inaccessible Space across accounts", () => {
    expect(
      legacyAgentDestination(
        "?spaceId=another-space&path=%2Fprivate%2Fproject",
        new Set(["my-space"]),
      ),
    ).toBe("/spaces");
  });
});
