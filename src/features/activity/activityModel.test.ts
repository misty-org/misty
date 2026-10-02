import { describe, expect, it } from "vitest";
import { formatActivityBadge } from "./activityModel";

describe("activityModel", () => {
  it("formats visible badges without losing the full underlying count", () => {
    expect(formatActivityBadge(0)).toBe("0");
    expect(formatActivityBadge(99)).toBe("99");
    expect(formatActivityBadge(100)).toBe("99+");
  });
});
