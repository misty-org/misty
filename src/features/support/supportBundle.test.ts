import { beforeEach, describe, expect, it } from "vitest";
import { useActivityStore } from "@/features/activity/useActivityStore";
import { buildSupportBundle } from "./supportBundle";

describe("support bundle", () => {
  beforeEach(() => {
    localStorage.clear();
    useActivityStore.setState(useActivityStore.getInitialState(), true);
  });

  it("includes only the active account and deployment diagnostics", async () => {
    const store = () => useActivityStore.getState();
    store().setAccount("one");
    store().ingestLocal({
      id: "diagnostic",
      kind: "failure",
      visibility: "diagnostic",
      title: "Hosted-only diagnostic",
    });
    localStorage.setItem("misty:deployment-scope", "private");
    store().setAccount("one");
    store().ingestLocal({
      id: "diagnostic",
      kind: "failure",
      visibility: "diagnostic",
      title: "Private-only diagnostic",
    });
    expect(JSON.stringify(await buildSupportBundle())).not.toContain("Hosted-only");
    expect(JSON.stringify(await buildSupportBundle())).toContain("Private-only");
    store().setAccount("two");
    expect(JSON.stringify(await buildSupportBundle())).not.toContain("Private-only");
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
    expect(bundle.runtime).toMatchObject({
      route_family: expect.any(String),
      captured_event_count: 1,
    });
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).toContain("[REDACTED_USER_DATA]");
    expect(serialized).toContain("[REDACTED_TOKEN]");
  });
});
