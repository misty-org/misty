import { expect, it } from "vitest";
import { answerNotStarted, currentFailureWords } from "./failureSummary";

it("says what to do when an answer didn't start", () => {
  expect(answerNotStarted).toBe(
    "This answer didn't start. Try again, and if it fails again, quit Misty and open it again.",
  );
});

it("reads a failure saved in the old words like a new one", () => {
  expect(
    currentFailureWords("Misty could not start this answer. Ordinary search is still available."),
  ).toBe(answerNotStarted);
  expect(currentFailureWords("The page closed before the step ran.")).toBe(
    "The page closed before the step ran.",
  );
});
