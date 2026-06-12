import { describe, expect, it } from "vitest";
import { isRetiredLegacyAgent } from "./legacyAgents";

describe("legacy Misty agents", () => {
  it("retires the old Buzz and Steve personas regardless of casing", () => {
    expect(isRetiredLegacyAgent({ name: "buzz" })).toBe(true);
    expect(isRetiredLegacyAgent({ name: " Steve " })).toBe(true);
    expect(isRetiredLegacyAgent({ name: "Researcher" })).toBe(false);
  });
});
