import { describe, expect, it } from "vitest";
import { splitFailure } from "./failureSummary";

describe("splitFailure", () => {
  it("keeps the answer as the answer and only the failed step as the reason", () => {
    const text =
      "Here is the bundle summary.\n\n1. Target iPad Air.\n\nI couldn't fully complete that request. screen close: The tool could not complete this action.";
    expect(splitFailure(text)).toEqual({
      answer: "Here is the bundle summary.\n\n1. Target iPad Air.",
      reason: "screen close: The tool could not complete this action.",
    });
  });

  it("has no reason when the text names no failed step, and never puts it in the row", () => {
    expect(splitFailure("Misty's model providers are temporarily unavailable.")).toEqual({
      answer: "Misty's model providers are temporarily unavailable.",
      reason: "",
    });
  });

  it("shortens a long reason", () => {
    const { reason } = splitFailure(`I couldn't fully complete that request. ${"x".repeat(400)}`);
    expect(reason.length).toBeLessThanOrEqual(200);
    expect(reason.endsWith("…")).toBe(true);
  });
});
