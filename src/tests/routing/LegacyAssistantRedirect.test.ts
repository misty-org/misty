import { describe, expect, it } from "vitest";
import { legacyAssistantDestination } from "@/routing/LegacyAssistantRedirect";

describe("legacyAssistantDestination", () => {
  it("redirects legacy links to Agents and preserves context", () => {
    expect(legacyAssistantDestination("?path=%2Ftmp%2Fwork&paths=a%2Cb")).toBe(
      "/agents?path=%2Ftmp%2Fwork&paths=a%2Cb",
    );
  });

  it("preserves a requested Space context", () => {
    expect(
      legacyAssistantDestination(
        "?spaceId=space%2Fone&path=%2Fprivate&paths=secret",
        new Set(["space/one"]),
      ),
    ).toBe("/agents?spaceId=space%2Fone&path=%2Fprivate&paths=secret");
  });

  it("lets the Agents page perform current-account access checks", () => {
    expect(
      legacyAssistantDestination(
        "?spaceId=another-space&path=%2Fprivate%2Fproject",
        new Set(["my-space"]),
      ),
    ).toBe("/agents?spaceId=another-space&path=%2Fprivate%2Fproject");
  });
});
