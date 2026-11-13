import { normalizeApiBaseUrl, withDefaultApiPath } from "@/api/client/base-url";
import { describe, expect, it } from "vitest";

describe("API base URL contract", () => {
  it("preserves versioned API bases", () => {
    expect(withDefaultApiPath(normalizeApiBaseUrl("https://api.mistysys.com/v1/"))).toBe(
      "https://api.mistysys.com/v1",
    );
  });

  it("moves older origin-only and /api settings to /v1", () => {
    expect(withDefaultApiPath(normalizeApiBaseUrl("http://localhost:8081"))).toBe(
      "http://localhost:8081/v1",
    );
    expect(withDefaultApiPath(normalizeApiBaseUrl("https://mistysys.com/api/"))).toBe(
      "https://mistysys.com/v1",
    );
  });
});
