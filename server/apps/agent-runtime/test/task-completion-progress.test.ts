import { describe, expect, it } from "vitest";
import { isProgressNote } from "../src/task-completion.js";

describe("progress notes", () => {
  it("tells a progress line from an answer", () => {
    expect(isProgressNote("Last: the UBalt visit page is already read and open, so I'm not reopening it. Next: I'll read UMD's Leadership Scholars page, then finish.")).toBe(true);
    expect(isProgressNote("**Last:** opened three tabs. **Have:** 4 of 10. **Next:** open the next five.")).toBe(true);
    expect(isProgressNote("**Recommendation: contact American University first.** Its PIPS scholarship is the largest. Next steps for you: call admissions.")).toBe(false);
    expect(isProgressNote("Last year the school changed its deadline. " + "Detail. ".repeat(80))).toBe(false);
  });
});
