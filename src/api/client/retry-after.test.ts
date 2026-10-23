import { expect, it, vi } from "vitest";
import { parseRetryAfter } from "./errors";
it("parses Retry-After seconds and HTTP dates without accepting invalid headers", () => {
  expect(parseRetryAfter("120")).toBe(120000);
  expect(parseRetryAfter(null)).toBeUndefined();
  expect(parseRetryAfter("invalid")).toBeUndefined();
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-11T00:00:00Z"));
  try {
    expect(parseRetryAfter("Fri, 11 Sep 2026 00:02:00 GMT")).toBe(120000);
  } finally {
    now.mockRestore();
  }
});
