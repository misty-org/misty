import { describe, expect, it } from "vitest";
import { readMistyAppRuntimeIdentity } from "./sdk";

describe("Misty App runtime identity", () => {
  it("accepts the identity assigned to an App document", () => {
    expect(
      readMistyAppRuntimeIdentity(
        "https://apps.mistysys.com/index.html?mistyAppId=journal&mistyAppInstance=misty-app-123e4567-e89b-12d3-a456-426614174000",
      ),
    ).toEqual({
      appId: "journal",
      instanceId: "misty-app-123e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("rejects documents that were not launched by Misty", () => {
    expect(() =>
      readMistyAppRuntimeIdentity("https://example.com/index.html"),
    ).toThrow("valid Misty runtime identity");
  });
});
