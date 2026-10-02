import { describe, expect, it } from "vitest";
import { requestsScreenContext } from "./companionIntent";
describe("companion explanation admission", () => {
  it.each(["Explain this problem", "What are the words on my screen?", "What is this?"])(
    "obtains fresh context for %s",
    (prompt) => expect(requestsScreenContext(prompt)).toBe(true),
  );
});
