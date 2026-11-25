import { describe, expect, it } from "vitest";
import type { ListingEntry, McpEntry, PluginEntry } from "@/native/registry";
import { facetMatches } from "./ExploreKinds";
import { frontMatter, rankText, sorted, wordsMatch } from "./explore_index";

const entry = (id: string, name: string, maker: string, rank?: number): ListingEntry => ({
  id,
  name,
  maker,
  rank,
  description: "",
  category: "development",
});

describe("explore index helpers", () => {
  it("reads a template's front matter and keeps its body as instructions", () => {
    const { fields, body } = frontMatter(
      '---\nname: a11y-architect\ndescription: "Accessibility Architect"\ntools: Read, Grep\n---\n\nYou are an accessibility architect.\n',
    );
    expect(fields).toEqual({
      name: "a11y-architect",
      description: "Accessibility Architect",
      tools: "Read, Grep",
    });
    expect(body.trim()).toBe("You are an accessibility architect.");
    expect(frontMatter("No front matter").body).toBe("No front matter");
  });

  it("orders by rank, then name, maker or name alone", () => {
    const items = [
      entry("b", "Beta", "zed", 5),
      entry("a", "Alpha", "amy", 50),
      entry("c", "Gamma", "amy", 5),
    ];
    expect(sorted(items, "popular").map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(sorted(items, "name").map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(sorted(items, "maker").map((one) => one.id)).toEqual(["a", "c", "b"]);
  });

  it("matches every word of a search, in any field", () => {
    expect(wordsMatch("pdf merge", "PDF tools", "Merge files")).toBe(true);
    expect(wordsMatch("pdf video", "PDF tools", "Merge files")).toBe(false);
    expect(wordsMatch("  ", "anything")).toBe(true);
  });

  it("shows stars the way the App Store shows counts", () => {
    expect(rankText(undefined)).toBe("");
    expect(rankText(950)).toBe("950");
    expect(rankText(1500)).toBe("1.5k");
    expect(rankText(119404)).toBe("119k");
  });

  it("filters plugins by what they add and MCP servers by how they connect", () => {
    const plugin = {
      ...entry("p", "P", "m"),
      includes: { skills: 2, agents: 0, commands: 0, hooks: true, mcp: false },
    } as PluginEntry;
    expect(facetMatches("plugins", plugin, "skills")).toBe(true);
    expect(facetMatches("plugins", plugin, "agents")).toBe(false);
    expect(facetMatches("plugins", plugin, "hooks")).toBe(true);
    const hosted = {
      ...entry("m", "M", "m"),
      remote: { url: "https://mcp.example.com" },
    } as McpEntry;
    expect(facetMatches("mcps", hosted, "remote")).toBe(true);
    expect(facetMatches("mcps", hosted, "package")).toBe(false);
    expect(facetMatches("skills", entry("s", "S", "m"), "all")).toBe(true);
  });
});
