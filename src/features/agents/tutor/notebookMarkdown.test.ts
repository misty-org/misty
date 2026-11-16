import { describe, expect, it } from "vitest";
import { notebookFromMarkdown, notebookMarkdown, spaceNotesOf } from "./notebookMarkdown";
import type { Notebook } from "./tutorTypes";

const at = "2026-11-12T00:00:00.000Z";
const notebook: Notebook = {
  id: "notebook-1",
  title: "Sourdough",
  sources: [
    {
      id: "s1",
      kind: "link",
      title: "Starter basics",
      url: "https://example.com/starter",
      summary: "How to feed a starter.",
      context: "full",
      createdAt: at,
    },
    {
      id: "s2",
      kind: "text",
      title: "My notes",
      text: "secret",
      summary: "Hydration ratios.",
      context: "summary",
      createdAt: at,
    },
    { id: "s3", kind: "text", title: "Left out", text: "x", context: "off", createdAt: at },
  ],
  notes: [
    {
      id: "n1",
      title: "Schedule",
      body: "Feed at 9am.\n\nBake at 5pm.",
      origin: "person",
      createdAt: at,
      updatedAt: at,
    },
  ],
  transformations: [],
  chats: [],
  brief: {
    summary: "All about bread.",
    topics: ["starter"],
    questions: ["Why rise?"],
    sources: "s1",
  },
  createdAt: at,
  updatedAt: at,
};

describe("a notebook's readable copy", () => {
  it("writes the overview, the sources it uses and the notes, never a source's full text", () => {
    const markdown = notebookMarkdown(notebook);
    expect(markdown).toContain("## Overview\n\nAll about bread.");
    expect(markdown).toContain(
      "- [Starter basics](https://example.com/starter): How to feed a starter.",
    );
    expect(markdown).toContain("- My notes: Hydration ratios.");
    expect(markdown).not.toContain("Left out");
    expect(markdown).not.toContain("secret");
    expect(markdown).toContain("### Schedule\n\nFeed at 9am.");
  });

  it("reads a doc back into sources and notes", () => {
    const read = notebookFromMarkdown(notebookMarkdown(notebook));
    expect(read.sources).toEqual([
      { kind: "link", title: "Starter basics", url: "https://example.com/starter" },
      { kind: "text", title: "My notes", text: "Hydration ratios." },
    ]);
    expect(read.notes.map((item) => item.title)).toEqual(["Overview", "Schedule"]);
    expect(read.notes[1]!.body).toBe("Feed at 9am.\n\nBake at 5pm.");
  });

  it("reads what a Space wrote under Space notes in a doc from before into a note", () => {
    const old = `${notebookMarkdown(notebook)}\n## Space notes\n\nAsk Sam about rye flour.\n`;
    expect(spaceNotesOf(old)).toBe("Ask Sam about rye flour.");
    const read = notebookFromMarkdown(old);
    expect(read.notes[read.notes.length - 1]).toEqual({
      title: "Space notes",
      body: "Ask Sam about rye flour.",
    });
  });

  it("writes no Space notes section of its own", () => {
    expect(notebookMarkdown(notebook)).not.toContain("## Space notes");
  });
});
