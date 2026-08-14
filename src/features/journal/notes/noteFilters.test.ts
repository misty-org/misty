import { describe, expect, it } from "vitest";
import type { UnifiedNote } from "./model/types/types";
import { notesInGroup, searchNotes, selectVisibleNotes } from "./noteFilters";

const now = Date.parse("2026-07-20T12:00:00.000Z");

function note(overrides: Partial<UnifiedNote> & { id: string }): UnifiedNote {
  return {
    source: "misty",
    sourceId: overrides.id,
    title: "Title",
    body: "",
    bodyFormat: "markdown",
    preview: "",
    tags: [],
    backlinks: [],
    updatedAt: new Date(now - 60_000).toISOString(),
    createdAt: new Date(now - 60_000).toISOString(),
    syncStatus: "synced",
    ...overrides,
  };
}

const notes: UnifiedNote[] = [
  note({
    id: "a",
    title: "Roadmap",
    spaceId: "s1",
    spaceName: "Product",
    tags: ["planning"],
  }),
  note({
    id: "b",
    title: "Interview notes",
    preview: "eleven calls",
    spaceId: "s1",
    spaceName: "Product",
    updatedAt: new Date(now - 30_000).toISOString(),
  }),
  note({
    id: "c",
    title: "Platform note",
    spaceId: "s2",
    spaceName: "Platform",
    updatedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
  }),
  note({ id: "d", title: "Old unlinked local note" }),
];

describe("notesInGroup", () => {
  it("only returns notes attached to the active Space", () => {
    expect(notesInGroup(notes, "space", now, "s1").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(notesInGroup(notes, "space", now, "s2").map((entry) => entry.id)).toEqual(["c"]);
  });

  it("returns nothing when no Space is active", () => {
    expect(notesInGroup(notes, "space", now, undefined)).toEqual([]);
  });
});

describe("searchNotes", () => {
  it("matches on title, Space name, tags, and preview", () => {
    expect(searchNotes(notes, "roadmap").map((entry) => entry.id)).toEqual(["a"]);
    expect(searchNotes(notes, "platform").map((entry) => entry.id)).toEqual(["c"]);
    expect(searchNotes(notes, "planning").map((entry) => entry.id)).toEqual(["a"]);
    expect(searchNotes(notes, "eleven").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("requires every term to match", () => {
    expect(searchNotes(notes, "roadmap product").map((entry) => entry.id)).toEqual(["a"]);
    expect(searchNotes(notes, "roadmap platform")).toEqual([]);
  });
});

describe("selectVisibleNotes", () => {
  it("intersects active Space notes with the query", () => {
    expect(selectVisibleNotes(notes, "roadmap", now, "s1").map((entry) => entry.id)).toEqual(["a"]);
    expect(selectVisibleNotes(notes, "roadmap", now, "s2")).toEqual([]);
  });

  it("sorts current-Space notes newest first", () => {
    expect(selectVisibleNotes(notes, "", now, "s1").map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("does not surface unlinked notes in the beta view", () => {
    expect(selectVisibleNotes(notes, "old", now, "s1")).toEqual([]);
  });
});
