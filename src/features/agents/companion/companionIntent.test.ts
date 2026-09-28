import { describe, expect, it } from "vitest";
import { isCompanionExplanation, requestsScreenContext } from "./companionIntent";
describe("companion explanation admission", () => {
  it.each([
    "Can you show me the solution to this puzzle?",
    "Can you tell me the solution to this problem?",
    "What is on my screen?",
    "Explain this error",
    "Where should I click?",
    "How do I solve this?",
  ])("answers %s without admitting action tools", (prompt) =>
    expect(isCompanionExplanation(prompt)).toBe(true),
  );
  it.each([
    "Click the blue button once",
    "Can you open that page?",
    "What is this and click the button",
    "Explain this, then download it",
    "Find current weather",
  ])("retains permission-aware execution for %s", (prompt) =>
    expect(isCompanionExplanation(prompt)).toBe(false),
  );
  it.each(["Explain this problem", "What are the words on my screen?", "What is this?"])(
    "obtains fresh context for %s",
    (prompt) => expect(requestsScreenContext(prompt)).toBe(true),
  );
});
