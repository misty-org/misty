import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  makingOf,
  mergeNotebook,
  noteMap,
  noteSeed,
  notebookRoots,
  replaceText,
  setNoteMarkdown,
  sharedFileText,
  takeLease,
  writeMaking,
  writeNotebook,
} from "./notebookDoc";
import type { Notebook, NotebookNote, NotebookSource, TutorJob } from "./tutorTypes";

const at = "2026-11-01T00:00:00Z";
const source = (id: string, change: Partial<NotebookSource>): NotebookSource => ({
  id,
  kind: "text",
  title: id,
  context: "full",
  createdAt: at,
  ...change,
});
const note = (id: string, body: string): NotebookNote => ({
  id,
  title: id,
  body,
  origin: "person",
  createdAt: at,
  updatedAt: at,
});
const notebook = (change: Partial<Notebook> = {}): Notebook => ({
  id: "n1",
  title: "Volcanoes",
  sources: [],
  notes: [],
  transformations: [],
  chats: [],
  createdAt: at,
  updatedAt: at,
  ...change,
});

describe("a notebook in its Space doc", () => {
  const mine = notebook({
    emoji: "🌋",
    sources: [
      source("pasted", { text: "Lava is hot.", context: "off" }),
      source("page", {
        kind: "link",
        url: "https://example.com",
        text: "Read here",
        context: "summary",
      }),
      source("book", { kind: "file", text: "x".repeat(sharedFileText + 5) }),
    ],
    notes: [note("note-1", "# Flows")],
  });

  it("shares what everyone works on, and keeps what is this person's own on their computer", () => {
    const doc = new Y.Doc();
    writeNotebook(doc, undefined, mine, "me");

    const roots = notebookRoots(doc);
    expect(roots.meta.get("schema")).toBe(1);
    expect(roots.meta.get("emoji")).toBe("🌋");
    const shared = roots.sources.toArray().map((map) => map.toJSON());
    expect(shared.map((item) => item.addedBy)).toEqual(["me", "me", "me"]);
    expect(shared.some((item) => "context" in item)).toBe(false);
    expect(shared[1].text).toBeUndefined();
    expect(shared[2]).toMatchObject({ truncated: true });
    expect((shared[2].text as string).length).toBe(sharedFileText);

    // A teammate's computer has none of this person's own choices or reads.
    const theirs = mergeNotebook(notebook({ title: "" }), doc);
    expect(theirs.title).toBe("Volcanoes");
    expect(theirs.sources.map((item) => item.context)).toEqual(["full", "full", "full"]);
    expect(theirs.sources[0].text).toBe("Lava is hot.");
    expect(theirs.sources[1].text).toBeUndefined();
    expect(theirs.notes).toMatchObject([{ id: "note-1", body: "# Flows", authorId: "me" }]);

    // This person's own copy keeps them.
    const back = mergeNotebook(mine, doc);
    expect(back.sources.map((item) => item.context)).toEqual(["off", "summary", "full"]);
    expect(back.sources[1].text).toBe("Read here");
  });

  it("takes a removed source out and marks a note an agent rewrote for its editor", () => {
    const doc = new Y.Doc();
    writeNotebook(doc, undefined, mine, "me");
    const next = {
      ...mine,
      sources: mine.sources.slice(1),
      notes: [note("note-1", "# Rewritten")],
    };
    writeNotebook(doc, mine, next, "me");

    expect(
      notebookRoots(doc)
        .sources.toArray()
        .map((map) => map.get("id")),
    ).toEqual(["page", "book"]);
    const map = noteMap(doc, "note-1")!;
    expect(map.get("stale")).toBe(true);
    expect(noteSeed(map)).toBe("# Rewritten");

    setNoteMarkdown(doc, "note-1", "# Typed");
    expect(map.get("markdown")).toBe("# Typed");
    expect(map.get("stale")).toBeUndefined();
  });

  it("starts a note's editor from its Markdown only while its shared text is empty or behind", () => {
    const doc = new Y.Doc();
    writeNotebook(doc, undefined, notebook({ notes: [note("note-1", "# Flows")] }), "me");
    const map = noteMap(doc, "note-1")!;
    expect(noteSeed(map)).toBe("# Flows");
    (map.get("body") as Y.XmlFragment).insert(0, [new Y.XmlText("Flows")]);
    expect(noteSeed(map)).toBeUndefined();
  });
});

describe("what's being made", () => {
  const job = (id: string, change: Partial<TutorJob>): TutorJob => ({
    id,
    kind: "deck",
    title: "Flashcards: Volcanoes",
    agentId: "a1",
    prompt: "Make it",
    notebookId: "n1",
    state: "running",
    createdAt: at,
    updatedAt: at,
    ...change,
  });

  it("shows this person's Create runs, never the prompt, and takes down only their own", () => {
    const doc = new Y.Doc();
    notebookRoots(doc).making.set("theirs", {
      kind: "quiz",
      title: "Quiz",
      by: "sam",
      startedAt: "2026-10-31T00:00:00Z",
    });
    writeMaking(
      doc,
      [job("j1", {}), job("j2", { kind: "research" }), job("j3", { state: "done" })],
      "me",
      (id) => ({ id, name: "Nova" }),
    );
    expect(makingOf(doc)).toEqual([
      { id: "theirs", kind: "quiz", title: "Quiz", by: "sam", startedAt: "2026-10-31T00:00:00Z" },
      {
        id: "j1",
        kind: "deck",
        title: "Flashcards: Volcanoes",
        by: "me",
        agent: { id: "a1", name: "Nova" },
        startedAt: at,
      },
    ]);

    writeMaking(doc, [], "me");
    expect(makingOf(doc).map((item) => item.id)).toEqual(["theirs"]);
  });
});

describe("a lease", () => {
  it("goes to one computer until it runs out", async () => {
    const doc = new Y.Doc();
    expect(await takeLease(doc, "brief", "me", 60_000, 0)).toBe(true);
    expect(await takeLease(doc, "brief", "sam", 60_000, 0)).toBe(false);
    expect(await takeLease(doc, "brief", "me", 60_000, 0)).toBe(true);

    expect(await takeLease(doc, "news", "me", -1_000, 0)).toBe(true);
    expect(await takeLease(doc, "news", "sam", 60_000, 0)).toBe(true);
  });
});

describe("a shared text", () => {
  it("changes only the stretch that differs", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "hello world");
    const deltas: unknown[] = [];
    text.observe((event) => deltas.push(event.delta));

    replaceText(text, "hello there world");
    expect(text.toString()).toBe("hello there world");
    expect(deltas).toEqual([[{ retain: 6 }, { insert: "there " }]]);

    replaceText(text, "hello there world");
    expect(deltas).toHaveLength(1);
  });
});
