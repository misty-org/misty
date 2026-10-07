import { afterEach, describe, expect, it } from "vitest";
import { configureBrowserSearchEngine } from "@/features/workspace/browserSearchEngine";
import { browserSearchDestination } from "./search";

afterEach(() => configureBrowserSearchEngine("google"));

describe("global URL and web search", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["example.com/path", "https://example.com/path"],
    ["localhost:5173", "http://localhost:5173/"],
    ["browser workspaces", "https://www.google.com/search?q=browser%20workspaces"],
    ["javascript:alert(1)", "https://www.google.com/search?q=javascript%3Aalert(1)"],
  ])("resolves %s", (input, expected) => expect(browserSearchDestination(input)).toBe(expected));

  it("searches with the engine chosen in settings", () => {
    configureBrowserSearchEngine("duckduckgo");
    expect(browserSearchDestination("misty app")).toBe("https://duckduckgo.com/?q=misty%20app");
  });
});
