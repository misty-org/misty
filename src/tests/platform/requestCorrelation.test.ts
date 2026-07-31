import { describe, expect, it } from "vitest";
import { addRequestCorrelation, newClientRequestID } from "@/platform/requestCorrelation";

describe("request correlation", () => {
  it("creates privacy-safe, distinct ids", () => {
    const first = newClientRequestID();
    const second = newClientRequestID();
    expect(first).toMatch(/^desktop_[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
  });

  it("preserves an explicitly supplied correlation id", () => {
    const headers = new Headers({ "X-Request-ID": "caller-request-123" });
    addRequestCorrelation(headers);
    expect(headers.get("X-Request-ID")).toBe("caller-request-123");
  });
});
