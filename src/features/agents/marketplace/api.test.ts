import { describe, expect, it } from "vitest";
import { itemDetails, matchItems, orderItems, unaddedSuggestions, type MarketItem } from "./api";

const item = (patch: Partial<MarketItem>): MarketItem => ({
  id: "x@m",
  name: "X",
  description: "",
  engine: "claude",
  marketplace: "m",
  category: null,
  installed: false,
  enabled: false,
  installs: null,
  link: null,
  signIn: null,
  stars: null,
  ...patch,
});

describe("engine marketplace", () => {
  const slack = item({ id: "slack@official", name: "Slack", description: "Search messages" });
  const gmail = item({
    id: "gmail@curated",
    name: "Gmail",
    category: "Communication",
    installed: true,
  });
  const linear = item({ id: "linear@official", name: "Linear", installs: 5000 });

  it("finds plugins by every word, across name, description and category", () => {
    expect(matchItems([slack, gmail, linear], "search mess", false)).toEqual([slack]);
    expect(matchItems([slack, gmail, linear], "communication", false)).toEqual([gmail]);
    expect(matchItems([slack, gmail, linear], "", true)).toEqual([gmail]);
  });

  it("puts installed plugins first, then the most installed", () => {
    expect(orderItems([slack, linear, gmail]).map((entry) => entry.name)).toEqual([
      "Gmail",
      "Linear",
      "Slack",
    ]);
  });

  it("suggests only marketplaces the engine doesn't read yet", () => {
    const sources = [
      { name: "claude-plugins-official", location: "anthropics/claude-plugins-official" },
      { name: "claude-code-workflows", location: "https://github.com/wshobson/agents.git" },
    ];
    const suggested = unaddedSuggestions("claude", sources).map((entry) => entry.source);
    expect(suggested).not.toContain("wshobson/agents");
    expect(suggested).toContain("anthropics/skills");
    expect(unaddedSuggestions("codex", []).length).toBeGreaterThan(0);
  });

  it("says where a plugin is from and when it signs in", () => {
    expect(
      itemDetails(item({ description: "Mail", installs: 1200, signIn: "on_install" })),
    ).toMatch(/^Mail · m · 1\.2K installs · Signs in when installed$/);
  });
});
