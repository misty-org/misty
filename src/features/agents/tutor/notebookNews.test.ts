import { describe, expect, it, vi } from "vitest";

vi.mock("../engines/engineRun", () => ({ runOnEngine: vi.fn() }));

import { newsPrompt, parseNews } from "./notebookNews";

describe("notebook news", () => {
  it("asks the default engine for recent stories from its own searches", () => {
    const prompt = newsPrompt("solar power", "day");
    expect(prompt).toContain("solar power");
    expect(prompt).toContain("the past day");
    expect(prompt).toContain("don't open the pages");
  });

  it("reads the stories with a web address, and drops the rest", () => {
    const reply =
      '```json\n{"stories": [{"title": "Panels get cheaper", "url": "https://example.com/a", ' +
      '"source": "Example", "published": "2 hours ago"}, {"title": "No link", "url": "nope"}]}\n```';
    expect(parseNews(reply)).toEqual([
      {
        title: "Panels get cheaper",
        url: "https://example.com/a",
        source: "Example",
        published: "2 hours ago",
      },
    ]);
  });
});
