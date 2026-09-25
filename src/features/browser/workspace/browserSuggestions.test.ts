import { describe, expect, it } from "vitest";
import { buildBrowserSuggestions } from "./browserSuggestions";

describe("browser omnibox suggestions", () => {
  it("offers a direct site before a web search", () => {
    const suggestions = buildBrowserSuggestions("youtube.com", []);

    expect(suggestions.map((item) => item.kind)).toEqual(["site", "search"]);
    expect(suggestions[0]?.destination).toBe("https://youtube.com/");
    expect(suggestions[0]?.faviconUrl).toBeNull();
    expect(suggestions[1]?.detail).toBe("Search with Google");
  });

  it("offers a direct HTTP site for local ports and addresses before web search", () => {
    const localhostSuggestions = buildBrowserSuggestions("localhost:3000", []);
    expect(localhostSuggestions.map((item) => item.kind)).toEqual(["site", "search"]);
    expect(localhostSuggestions[0]?.destination).toBe("http://localhost:3000/");
    expect(localhostSuggestions[0]?.title).toBe("localhost:3000");
    expect(localhostSuggestions[0]?.detail).toBe("localhost:3000");
    expect(localhostSuggestions[1]?.detail).toBe("Search with Google");

    const ipSuggestions = buildBrowserSuggestions("127.0.0.1:8080/api", []);
    expect(ipSuggestions.map((item) => item.kind)).toEqual(["site", "search"]);
    expect(ipSuggestions[0]?.destination).toBe("http://127.0.0.1:8080/api");
    expect(ipSuggestions[0]?.title).toBe("127.0.0.1:8080");
    expect(ipSuggestions[0]?.detail).toBe("127.0.0.1:8080/api");
  });

  it("matches and deduplicates recent browser history", () => {
    const suggestions = buildBrowserSuggestions("docs", [
      "https://example.com/elsewhere",
      "https://docs.example.com/start",
      "https://docs.example.com/start",
    ]);

    expect(suggestions.filter((item) => item.kind === "history")).toHaveLength(1);
    expect(suggestions[0]?.title).toBe("docs.example.com");
    expect(suggestions[0]?.faviconUrl).toBe("https://docs.example.com/favicon.ico");
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
