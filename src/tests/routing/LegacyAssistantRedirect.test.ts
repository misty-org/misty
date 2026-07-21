import { describe, expect, it } from "vitest";
import { legacyAssistantDestination } from "@/routing/LegacyAssistantRedirect";

describe("legacyAssistantDestination", () => {
  it("opens Mika in Files and preserves private file context", () => {
    expect(legacyAssistantDestination("?path=%2Ftmp%2Fwork&paths=a%2Cb")).toBe(
      "/files?path=%2Ftmp%2Fwork&paths=a%2Cb&mika=open",
    );
  });

  it("opens Mika in the requested Space without carrying local paths", () => {
    expect(
      legacyAssistantDestination(
        "?spaceId=space%2Fone&path=%2Fprivate&paths=secret",
        new Set(["space/one"]),
      ),
    ).toBe("/spaces/space%2Fone/assistant");
  });

  it("falls back to Files when the current account cannot access the requested Space", () => {
    expect(
      legacyAssistantDestination(
        "?spaceId=another-space&path=%2Fprivate%2Fproject",
        new Set(["my-space"]),
      ),
    ).toBe("/files?path=%2Fprivate%2Fproject&mika=open");
  });
});
