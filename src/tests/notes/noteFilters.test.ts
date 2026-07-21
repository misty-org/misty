import { describe, expect, it } from "vitest";
import type { UnifiedNote } from "@/models/types/features/notes/types";
import {
  groupCounts,
  notesInGroup,
  relativeTime,
  searchNotes,
  selectVisibleNotes,
} from "@/features/notes/noteFilters";

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
    favorite: false,
    syncStatus: "synced",
    ...overrides,
  };
}

const notes: UnifiedNote[] = [
  note({ id: "a", title: "Roadmap", spaceId: "s1", spaceName: "Product", tags: ["planning"] }),
  note({ id: "b", source: "notion", title: "Interviews", preview: "eleven calls", favorite: true }),
  note({
    id: "c",
    title: "Old note",
    spaceId: "s2",
    spaceName: "Platform",
    updatedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
  }),
];

describe("notesInGroup", () => {
  it("scopes the Space lens to the active Space", () => {
    expect(notesInGroup(notes, "space", now, "s1").map((entry) => entry.id)).toEqual(["a"]);
    expect(notesInGroup(notes, "space", now, "s2").map((entry) => entry.id)).toEqual(["c"]);
  });

  it("returns nothing for the Space lens when no Space is active", () => {
    expect(notesInGroup(notes, "space", now, undefined)).toEqual([]);
  });

  it("keeps the other groups cross-Space so loose notes stay findable", () => {
    expect(notesInGroup(notes, "all", now, "s1")).toHaveLength(3);
    expect(notesInGroup(notes, "unlinked", now, "s1").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("splits by connector source", () => {
    expect(notesInGroup(notes, "misty", now).map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(notesInGroup(notes, "notion", now).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("treats notes without a Space as unlinked", () => {
    expect(notesInGroup(notes, "unlinked", now).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("limits recently updated to the last 48 hours", () => {
    expect(notesInGroup(notes, "recent", now).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("filters favorites", () => {
    expect(notesInGroup(notes, "favorites", now).map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("searchNotes", () => {
  it("matches on title", () => {
    expect(searchNotes(notes, "roadmap").map((entry) => entry.id)).toEqual(["a"]);
  });

  it("matches on Space name", () => {
    expect(searchNotes(notes, "platform").map((entry) => entry.id)).toEqual(["c"]);
  });

  it("matches on tags", () => {
    expect(searchNotes(notes, "planning").map((entry) => entry.id)).toEqual(["a"]);
  });

  it("matches on source name", () => {
    expect(searchNotes(notes, "notion").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("matches on preview text", () => {
    expect(searchNotes(notes, "eleven").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("requires every term to match", () => {
    expect(searchNotes(notes, "roadmap product").map((entry) => entry.id)).toEqual(["a"]);
    expect(searchNotes(notes, "roadmap platform")).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(searchNotes(notes, "   ")).toHaveLength(3);
  });
});

describe("selectVisibleNotes", () => {
  it("intersects the Space lens with the query", () => {
    expect(selectVisibleNotes(notes, "space", "roadmap", now, "s1").map((n) => n.id)).toEqual([
      "a",
    ]);
    expect(selectVisibleNotes(notes, "space", "roadmap", now, "s2")).toEqual([]);
  });

  it("applies the group filter before the query and sorts newest first", () => {
    const visible = selectVisibleNotes(notes, "misty", "", now);
    expect(visible.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("intersects group and query", () => {
    expect(selectVisibleNotes(notes, "notion", "roadmap", now)).toEqual([]);
  });
});

describe("groupCounts", () => {
  it("counts every sidebar group", () => {
    expect(groupCounts(notes, now, "s1")).toEqual({
      space: 1,
      all: 3,
      misty: 2,
      notion: 1,
      unlinked: 1,
      recent: 2,
      favorites: 1,
    });
  });
});

describe("relativeTime", () => {
  it("formats recent timestamps compactly", () => {
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("just now");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
    expect(relativeTime(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe("3d ago");
  });
});
