import { describe, expect, it } from "vitest";
import { buildBrowserSuggestions } from "./browserSuggestions";

describe("browser omnibox suggestions", () => {
  it("offers a direct site before a web search", () => {
    const suggestions = buildBrowserSuggestions("youtube.com", []);

    expect(suggestions.map((item) => item.kind)).toEqual(["site", "search"]);
    expect(suggestions[0]?.destination).toBe("https://youtube.com/");
    expect(suggestions[1]?.detail).toBe("Search with Google");
  });

  it("matches and deduplicates recent browser history", () => {
    const suggestions = buildBrowserSuggestions("docs", [
      "https://example.com/elsewhere",
      "https://docs.example.com/start",
      "https://docs.example.com/start",
    ]);

    expect(suggestions.filter((item) => item.kind === "history")).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("docs.example.com");
  });

  it("shows recent sites when the omnibox is empty", () => {
    const suggestions = buildBrowserSuggestions("", [
      "about:blank",
      "https://one.example/",
      "https://two.example/path",
    ]);

    expect(suggestions.map((item) => item.title)).toEqual(["two.example", "one.example"]);
  });
});
