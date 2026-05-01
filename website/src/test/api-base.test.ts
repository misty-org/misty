import { describe, expect, it } from "vitest";

import { resolveApiBase } from "../lib/apiBase";

describe("resolveApiBase", () => {
  it("keeps API requests same-origin by default", () => {
    expect(resolveApiBase("")).toBe("/api");
    expect(resolveApiBase("   ")).toBe("/api");
  });

  it("normalizes an explicitly configured API base", () => {
    expect(resolveApiBase("/custom/api/")).toBe("/custom/api");
  });
});
