import { describe, expect, it } from "vitest";
import type { GlobalSearchFilters, GlobalSearchResult } from "./types";
import { buildUnifiedMistyCandidates } from "./unifiedMistyCandidates";

const filters: GlobalSearchFilters = { kinds: [], source: "all", intent: "all" };

function result(title: string, score = 10): GlobalSearchResult {
  return {
    id: `note:${title}`,
    canonicalId: `note:${title}`,
    accountId: "account-1",
    kind: "note",
    title,
    body: "A matching note",
    keywords: ["note"],
    href: `/spaces/space-1/notes?note=${encodeURIComponent(title)}`,
    spaceId: "space-1",
    source: "server",
    score,
  };
}

describe("unified Misty candidates", () => {
  it("ranks a strong exact object ahead of synthetic AI outcomes", () => {
    const candidates = buildUnifiedMistyCandidates("Launch plan", [result("Launch plan")], filters);
    expect(candidates[0]).toMatchObject({ type: "object", title: "Launch plan" });
  });

  it("keeps retrieved objects first for conversational queries", () => {
    const candidates = buildUnifiedMistyCandidates(
      "How did we decide pricing?",
      [result("Pricing notes")],
      filters,
    );
    expect(candidates[0]?.type).toBe("object");
  });

  it("keeps retrieved objects first for action queries", () => {
    const candidates = buildUnifiedMistyCandidates(
      "Organize these notes into a launch plan",
      [result("Launch notes")],
      filters,
    );
    expect(candidates[0]?.type).toBe("object");
  });

  it("keeps an explicit handoff for polite requests", () => {
    const candidates = buildUnifiedMistyCandidates(
      "Can you create a launch plan?",
      [result("Launch notes")],
      filters,
    );
    expect(candidates[0]?.type).toBe("object");
  });

  it("routes direct drawing requests to Misty work", () => {
    const candidates = buildUnifiedMistyCandidates("Draw a cat", [], filters);
    expect(candidates[0]?.type).toBe("answer");
  });

  it("routes explicit Excalidraw creation to Misty work", () => {
    const candidates = buildUnifiedMistyCandidates(
      "Create an Excalidraw diagram showing a rocket launching toward the Moon",
      [],
      filters,
    );
    expect(candidates[0]?.type).toBe("answer");
  });

  it("turns navigation language into direct navigation candidates", () => {
    const candidates = buildUnifiedMistyCandidates(
      "open Launch plan",
      [result("Launch plan")],
      filters,
    );
    expect(candidates[0]).toMatchObject({ type: "navigation", title: "Launch plan" });
  });

  it("keeps selection identity canonical as result scores change", () => {
    const first = buildUnifiedMistyCandidates("launch", [result("Launch plan", 2)], filters);
    const enriched = buildUnifiedMistyCandidates("launch", [result("Launch plan", 40)], filters);
    expect(enriched.find((candidate) => candidate.title === "Launch plan")?.id).toBe(
      first.find((candidate) => candidate.title === "Launch plan")?.id,
    );
  });
});
