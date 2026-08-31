import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportSystemError, systemErrorMessage } from "./systemActivity";
import { useActivityStore } from "./useActivityStore";

vi.mock("./nativeNotifications", () => ({
  publishNativeActivity: vi.fn(async () => true),
  syncNativeBadge: vi.fn(async () => undefined),
}));

describe("system Activity", () => {
  beforeEach(() => {
    useActivityStore.setState({
      accountId: "account-1",
      sourceItems: [],
      localItems: [],
      allItems: [],
      attentionItems: [],
      attentionCount: 0,
    });
  });

  it("reports operational failures as attention items without native notifications", () => {
    reportSystemError({
      scope: "inbox:connection-1",
      title: "Inbox account could not refresh",
      error: new Error("Load failed"),
      target: { kind: "route", href: "/inbox" },
    });

    expect(useActivityStore.getState().allItems[0]).toMatchObject({
      kind: "failure",
      title: "Inbox account could not refresh",
      attention: true,
      target: { kind: "route", href: "/inbox" },
    });
  });

  it("scrubs infrastructure details from network failures", () => {
    expect(
      systemErrorMessage(
        new Error(
          "Could not reach https://dev-api.mistysys.com/v1/mail/threads?connection_id=connection_secret: Load failed",
        ),
      ),
    ).toBe("Misty could not reach the service. Check your connection and try again.");
  });

  it("scrubs explicitly supplied Activity details too", () => {
    reportSystemError({
      scope: "inbox",
      title: "Inbox could not refresh",
      body: "Could not reach https://dev-api.mistysys.com/v1/mail/threads: Load failed",
    });

    expect(useActivityStore.getState().allItems[0]?.body).toBe(
      "Misty could not reach the service. Check your connection and try again.",
    );
  });

  it("deduplicates the same failure within the reporting window", () => {
    const input = { scope: "inbox", title: "Inbox could not refresh", error: "Load failed" };
    reportSystemError(input);
    reportSystemError(input);
    expect(useActivityStore.getState().allItems).toHaveLength(1);
  });
});
