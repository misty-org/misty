import { describe, expect, it, vi } from "vitest";

vi.mock("./notebookNews", () => ({ latestNews: vi.fn() }));

import { followIsStale, newsToDrop, publishedAt } from "./notebookFollow";
import { notebookTopics, startOf } from "./notebookTopics";
import type { Notebook, NotebookSource } from "./tutorTypes";

const now = Date.parse("2026-11-12T12:00:00Z");

function notebook(sources: Partial<NotebookSource>[]): Notebook {
  return {
    id: "n",
    title: "NVDA",
    sources: sources.map((source, index) => ({
      id: `s${index}`,
      kind: "link",
      title: `Story ${index}`,
      context: "full",
      createdAt: "2026-11-01T00:00:00Z",
      ...source,
    })),
    notes: [],
    transformations: [],
    chats: [],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
}

describe("research topics", () => {
  it("each have questions and guidance", () => {
    for (const topic of notebookTopics) {
      expect(topic.questions.length).toBeGreaterThan(0);
      expect(topic.focus).not.toBe("");
    }
  });

  it("start a notebook the agent names, researching what was asked", () => {
    expect(startOf("  How do AI agents work? ")).toEqual({
      title: "Untitled notebook",
      research: "How do AI agents work?",
    });
  });
});

describe("following the news", () => {
  it("looks again after half an hour", () => {
    expect(followIsStale(undefined, now)).toBe(false);
    expect(followIsStale({ query: "x" }, now)).toBe(true);
    expect(followIsStale({ query: "x", checkedAt: "2026-11-12T11:50:00Z" }, now)).toBe(false);
    expect(followIsStale({ query: "x", checkedAt: "2026-11-12T11:00:00Z" }, now)).toBe(true);
  });

  it("dates stories from relative and absolute times", () => {
    expect(publishedAt("3 hours ago", now)).toBe("2026-11-12T09:00:00.000Z");
    expect(publishedAt("a day ago", now)).toBe("2026-11-11T12:00:00.000Z");
    expect(publishedAt("Nov 10, 2026", now)).toBe(new Date("Nov 10, 2026").toISOString());
    expect(publishedAt("sometime", now)).toBeUndefined();
    expect(publishedAt(undefined, now)).toBeUndefined();
  });

  it("keeps the newest fifteen stories and never drops other sources", () => {
    const stories = Array.from({ length: 17 }, (_, day) => ({
      news: true,
      published: new Date(now - day * 86_400_000).toISOString(),
    }));
    const dropped = newsToDrop(notebook([{}, ...stories]));
    expect(dropped).toEqual(["s16", "s17"]);
  });
});
