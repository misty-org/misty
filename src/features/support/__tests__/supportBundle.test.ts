import { beforeEach, describe, expect, it } from "vitest";
import { buildSupportBundle } from "../supportBundle";

describe("support bundle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("redacts sensitive values and never uploads anything", async () => {
    localStorage.setItem(
      "misty.clientDebug.events.v1",
      JSON.stringify([
        {
          id: "event_1",
          createdAt: "2026-07-28T12:00:00.000Z",
          level: "error",
          scope: "api",
          message: "Failed for person@example.com",
          detail: "Bearer abcdefghijklmnopqrstuvwxyz",
        },
      ]),
    );

    const bundle = await buildSupportBundle();
    const serialized = JSON.stringify(bundle);
    expect(bundle.notice).toContain("Review");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).toContain("[REDACTED_USER_DATA]");
    expect(serialized).toContain("[REDACTED_TOKEN]");
  });
});
