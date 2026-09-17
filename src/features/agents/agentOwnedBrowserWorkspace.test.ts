import { describe, expect, it } from "vitest";
import { agentBrowserResearchQuery } from "./agentOwnedBrowserWorkspace";

describe("agentBrowserResearchQuery", () => {
  it("opens an agent browser only for explicit web research", () => {
    expect(agentBrowserResearchQuery("Browse the web for family-friendly hikes nearby")).toBe(
      "family-friendly hikes nearby",
    );
    expect(agentBrowserResearchQuery("Look up current museum hours online")).toBe(
      "current museum hours online",
    );
    expect(agentBrowserResearchQuery("How many people are in Family Space?")).toBe("");
  });

  it("keeps follow-up Space writes out of the search query", () => {
    expect(
      agentBrowserResearchQuery(
        "Research summer camps in Pasadena and then save the research and post a summary",
      ),
    ).toBe("summer camps in Pasadena");
  });
});
