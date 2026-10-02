import { describe, expect, it } from "vitest";
import { activityStreak, contributionDates } from "./homeActivity";

describe("Home activity", () => {
  it("counts consecutive active days ending today", () => {
    const today = new Date(2026, 7, 28, 12);
    expect(
      activityStreak(
        {
          "2026-08-28": 1,
          "2026-08-27": 3,
          "2026-08-26": 1,
          "2026-08-24": 2,
        },
        today,
      ),
    ).toBe(3);
  });

  it("builds a chronological contribution window", () => {
    const dates = contributionDates(new Date(2026, 7, 28, 12), 7);
    expect(dates.map((date) => date.getDate())).toEqual([22, 23, 24, 25, 26, 27, 28]);
  });
});
