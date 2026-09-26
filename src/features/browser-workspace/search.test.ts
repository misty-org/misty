import { describe, expect, it } from "vitest";
import { browserSearchDestination } from "./search";
describe("global URL and Google search", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["example.com/path", "https://example.com/path"],
    ["localhost:5173", "http://localhost:5173/"],
    ["browser workspaces", "https://www.google.com/search?q=browser%20workspaces"],
    ["javascript:alert(1)", "https://www.google.com/search?q=javascript%3Aalert(1)"],
  ])("resolves %s", (input, expected) => expect(browserSearchDestination(input)).toBe(expected));
});
