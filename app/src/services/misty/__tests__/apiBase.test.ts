import { normalizeApiBaseUrl, withDefaultApiPath } from "@/services/backend";
import { describe, expect, it } from "vitest";

describe("API base URL contract", () => {
  it("preserves complete and versioned API bases", () => {
    expect(withDefaultApiPath(normalizeApiBaseUrl("https://mistysys.com/api/"))).toBe(
      "https://mistysys.com/api",
    );
    expect(withDefaultApiPath(normalizeApiBaseUrl("https://mistysys.com/api/v2"))).toBe(
      "https://mistysys.com/api/v2",
    );
  });

  it("keeps origin-only legacy settings compatible", () => {
    expect(withDefaultApiPath(normalizeApiBaseUrl("http://localhost:8081"))).toBe(
      "http://localhost:8081/api",
    );
  });
});
