import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSystemErrors,
  readSystemErrors,
  reportSystemError,
  systemErrorMessage,
} from "./systemErrors";

describe("system errors", () => {
  beforeEach(() => clearSystemErrors());

  it("records operational errors for support", () => {
    reportSystemError({
      scope: "inbox:connection-1",
      title: "Inbox account could not refresh",
      error: new Error("Load failed"),
    });

    expect(readSystemErrors()[0]).toMatchObject({ title: "Inbox account could not refresh" });
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

  it("scrubs explicitly supplied details too", () => {
    reportSystemError({
      scope: "inbox",
      title: "Inbox could not refresh",
      body: "Could not reach https://dev-api.mistysys.com/v1/mail/threads: Load failed",
    });

    expect(readSystemErrors()[0]?.body).toBe(
      "Misty could not reach the service. Check your connection and try again.",
    );
  });

  it("deduplicates the same failure", () => {
    const input = { scope: "inbox", title: "Inbox could not refresh", error: "Load failed" };
    reportSystemError(input);
    reportSystemError(input);
    expect(readSystemErrors()).toHaveLength(1);
  });
});
