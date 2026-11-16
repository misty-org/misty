import * as Y from "yjs";
import { newReview } from "./spacedReview";
import type {
  Deck,
  Flashcard,
  Guide,
  Notebook,
  NotebookNote,
  NotebookSource,
  TutorJob,
} from "./tutorTypes";

/**
 * A Lab notebook inside its Space doc, beside the doc's own `misty:*` types. Everyone in the Space
 * edits these together; each computer keeps a copy of the notebook (tutorStore) that mirrors them
 * and adds what stays the person's own: their chats, which sources their AI reads, link text read
 * on their computer, review progress and quiz scores.
 *
 * - `lab:meta`: title, emoji, topic, follow, brief, the discussion's id, the schema and leases.
 * - `lab:sources`: one map per source, in order.
 * - `lab:notes`: one map per note, newest first; its `body` is the text people edit together and
 *   its `markdown` the same note as Markdown, for the agents, search and the doc's readable copy.
 * - `lab:outputs`: what the Create pane made (decks and guides), for everyone.
 * - `lab:making`: what is being made right now, and by whom. Never the prompt.
 *
 * Writes from this computer's own store carry `localOrigin`, so the mirror doesn't read them back.
 */
export const NOTEBOOK_SCHEMA = 1;
export const localOrigin = "lab-local";
export const editorOrigin = "lab-editor";
/** A file's text kept in the doc, so teammates' AIs can read it too; the rest is cut. */
export const sharedFileText = 20_000;

export function notebookRoots(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>("lab:meta"),
    sources: doc.getArray<Y.Map<unknown>>("lab:sources"),
    notes: doc.getArray<Y.Map<unknown>>("lab:notes"),
    outputs: doc.getArray<Y.Map<unknown>>("lab:outputs"),
    making: doc.getMap<MakingItem>("lab:making"),
  };
}

/** Something being made in the Create pane, for everyone to see. */
export interface MakingItem {
  kind: TutorJob["kind"];
  title: string;
  by: string;
  /** The agent making it: its name only. */
  agent?: { id: string; name: string };
  startedAt: string;
}

export const isSeeded = (doc: Y.Doc) => notebookRoots(doc).meta.get("schema") != null;

const metaKeys = [
  "title",
  "emoji",
  "topic",
  "follow",
  "brief",
  "discussionId",
  "createdBy",
] as const;

const plain = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const defined = (record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

/**
 * What everyone shares of a source. A link's text is read again on each computer, and whether a
 * source goes to the AI is each person's own choice, so neither is in the doc.
 */
export function sharedSource(source: NotebookSource): Record<string, unknown> {
  const { context: _context, reading: _reading, text, truncated, ...rest } = source;
  const shared: Record<string, unknown> = { ...rest };
  if (source.kind === "text") shared.text = text;
  else if (source.kind !== "link" && text) {
    shared.text = text.slice(0, sharedFileText);
    shared.truncated = truncated || text.length > sharedFileText || undefined;
  }
  return defined(plain(shared));
}

/** What everyone shares of a note: all of it, its Markdown kept beside the text people edit. */
export function sharedNote(note: NotebookNote): Record<string, unknown> {
  const { body, ...rest } = note;
  return defined(plain({ ...rest, markdown: body }));
}

/** What everyone shares of a deck: its cards, without this person's review progress. */
export function sharedDeck(deck: Deck): Record<string, unknown> {
  return defined({
    id: deck.id,
    type: "deck",
    title: deck.title,
    cards: deck.cards.map(({ id, front, back }) => ({ id, front, back })),
    by: deck.by,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
  });
}

/** What everyone shares of a guide: all it shows, without this person's score, audio or chat. */
export function sharedGuide(guide: Guide): Record<string, unknown> {
  const {
    lastScore: _score,
    audio: _audio,
    conversationId: _chat,
    notebookId: _notebook,
    ...rest
  } = guide;
  return defined(plain({ ...rest, type: "guide" }));
}

/** Keeps a list of maps in step with this computer's list, changing only what changed. */
function syncList<T extends { id: string }>(
  list: Y.Array<Y.Map<unknown>>,
  before: readonly T[],
  after: readonly T[],
  shape: (item: T) => Record<string, unknown>,
  options: { newestFirst?: boolean; author: string; me: string; body?: boolean },
) {
  const at = (itemId: string) => list.toArray().findIndex((map) => map.get("id") === itemId);
  const next = new Set(after.map((item) => item.id));
  for (const item of before) {
    if (next.has(item.id)) continue;
    const index = at(item.id);
    if (index >= 0) list.delete(index, 1);
  }
  const previous = new Map(before.map((item) => [item.id, item]));
  for (const item of after) {
    const shaped = shape(item);
    const index = at(item.id);
    if (index < 0) {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(shaped)) map.set(key, value);
      if (map.get(options.author) == null) map.set(options.author, options.me);
      if (options.body) map.set("body", new Y.XmlFragment());
      if (options.newestFirst) list.insert(0, [map]);
      else list.push([map]);
      continue;
    }
    const old = previous.get(item.id);
    if (old && same(shape(old), shaped)) continue;
    const map = list.get(index);
    for (const [key, value] of Object.entries(shaped))
      if (!same(map.get(key), value)) map.set(key, value);
    for (const key of [...map.keys()])
      if (!(key in shaped) && key !== options.author && key !== "body" && key !== "stale")
        map.delete(key);
    // Markdown changed here rather than in the shared editor (an agent rewrote the note): the
    // editor takes it the next time someone opens the note.
    if (options.body && old && !same(shape(old).markdown, shaped.markdown)) map.set("stale", true);
  }
}

/** Writes this computer's change to the notebook into its doc. */
export function writeNotebook(
  doc: Y.Doc,
  before: Notebook | undefined,
  after: Notebook,
  me: string,
) {
  const roots = notebookRoots(doc);
  doc.transact(() => {
    if (roots.meta.get("schema") == null) roots.meta.set("schema", NOTEBOOK_SCHEMA);
    for (const key of metaKeys) {
      const next = after[key];
      if (before && same(before[key], next)) continue;
      if (next === undefined) roots.meta.delete(key);
      else if (!same(roots.meta.get(key), next)) roots.meta.set(key, plain(next));
    }
    syncList(roots.sources, before?.sources ?? [], after.sources, sharedSource, {
      author: "addedBy",
      me,
    });
    syncList(roots.notes, before?.notes ?? [], after.notes, sharedNote, {
      author: "authorId",
      me,
      newestFirst: true,
      body: true,
    });
  }, localOrigin);
}

/** Writes this computer's change to a notebook's decks and guides into its doc. */
export function writeOutputs(
  doc: Y.Doc,
  before: { decks: Deck[]; guides: Guide[] },
  after: { decks: Deck[]; guides: Guide[] },
  me: string,
) {
  const shape = (item: Deck | Guide) =>
    "cards" in item ? sharedDeck(item) : sharedGuide(item as Guide);
  const roots = notebookRoots(doc);
  doc.transact(() => {
    syncList<Deck | Guide>(
      roots.outputs,
      [...before.decks, ...before.guides],
      [...after.decks, ...after.guides],
      shape,
      { author: "by", me, newestFirst: true },
    );
  }, localOrigin);
}

/** Says what this person is making now, and takes down what they finished. */
export function writeMaking(
  doc: Y.Doc,
  jobs: readonly TutorJob[],
  me: string,
  agentOf: (agentId: string) => { id: string; name: string } = (id) => ({ id, name: "Agent" }),
  now = new Date(),
) {
  const making = notebookRoots(doc).making;
  const running = jobs.filter(
    (job) =>
      (job.state === "queued" || job.state === "running") &&
      !["brief", "summary", "research", "note"].includes(job.kind),
  );
  doc.transact(() => {
    for (const job of running)
      if (!making.has(job.id))
        making.set(job.id, {
          kind: job.kind,
          title: job.title,
          by: me,
          agent: agentOf(job.agentId),
          startedAt: job.createdAt || now.toISOString(),
        });
    const keep = new Set(running.map((job) => job.id));
    for (const [jobId, item] of making.entries())
      if (item.by === me && !keep.has(jobId)) making.delete(jobId);
  }, localOrigin);
}

/** The notebook as its doc has it, with what stays this person's own taken from their copy. */
export function mergeNotebook(local: Notebook, doc: Y.Doc): Notebook {
  const roots = notebookRoots(doc);
  const mine = new Map(local.sources.map((source) => [source.id, source]));
  const sources = roots.sources.toArray().map((map) => {
    const shared = map.toJSON() as NotebookSource;
    const own = mine.get(shared.id);
    const link = shared.kind === "link";
    return defined({
      ...shared,
      context: own?.context ?? "full",
      reading: own?.reading,
      text: link ? own?.text : (shared.text ?? own?.text),
      truncated: link ? own?.truncated : shared.truncated,
    }) as unknown as NotebookSource;
  });
  const notes = roots.notes.toArray().map((map) => {
    const {
      body: _body,
      stale: _stale,
      markdown,
      ...rest
    } = map.toJSON() as Record<string, unknown>;
    return { ...rest, body: String(markdown ?? "") } as unknown as NotebookNote;
  });
  const meta = (key: (typeof metaKeys)[number]) => roots.meta.get(key) as never;
  return {
    ...local,
    title: meta("title") ?? local.title,
    emoji: meta("emoji"),
    topic: meta("topic"),
    follow: meta("follow"),
    brief: meta("brief"),
    discussionId: meta("discussionId"),
    createdBy: meta("createdBy") ?? local.createdBy,
    sources,
    notes,
  };
}

/** The doc's decks and guides, with this person's review progress and scores kept. */
export function mergeOutputs(
  doc: Y.Doc,
  notebookId: string,
  local: { decks: Deck[]; guides: Guide[] },
  now = new Date(),
): { decks: Deck[]; guides: Guide[] } {
  const decks = new Map(local.decks.map((deck) => [deck.id, deck]));
  const guides = new Map(local.guides.map((guide) => [guide.id, guide]));
  const out = { decks: [] as Deck[], guides: [] as Guide[] };
  for (const map of notebookRoots(doc).outputs.toArray()) {
    const { type, ...data } = map.toJSON() as Record<string, unknown> & { type?: string };
    if (type === "deck") {
      const own = decks.get(String(data.id));
      const reviews = new Map(own?.cards.map((card) => [card.id, card.review]));
      const cards = ((data.cards as Omit<Flashcard, "review">[]) ?? []).map((card) => ({
        ...card,
        review: reviews.get(card.id) ?? newReview(now),
      }));
      out.decks.push({
        ...(data as unknown as Deck),
        cards,
        notebookId,
        conversationId: own?.conversationId,
      });
    } else if (type === "guide") {
      const own = guides.get(String(data.id));
      out.guides.push({
        ...(data as unknown as Guide),
        notebookId,
        lastScore: own?.lastScore,
        audio: own?.audio,
        conversationId: own?.conversationId,
      });
    }
  }
  return out;
}

/** What is being made in the notebook now, by others and by this person. */
export function makingOf(doc: Y.Doc): (MakingItem & { id: string })[] {
  return [...notebookRoots(doc).making.entries()]
    .map(([id, item]) => ({ ...item, id }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Asks to be the one computer that does `name` (writes the overview, looks for news), so a
 * notebook open on five computers runs it once. Yjs settles two claims made at once the same way
 * everywhere, so after a moment only the winner still sees its own name.
 */
export async function takeLease(doc: Y.Doc, name: string, me: string, ms = 60_000, settle = 400) {
  const meta = notebookRoots(doc).meta;
  const key = `lease:${name}`;
  const held = meta.get(key) as { userId: string; until: number } | undefined;
  if (held && held.userId !== me && held.until > Date.now()) return false;
  doc.transact(() => meta.set(key, { userId: me, until: Date.now() + ms }), localOrigin);
  if (settle) await new Promise((resolve) => setTimeout(resolve, settle));
  return (meta.get(key) as { userId?: string } | undefined)?.userId === me;
}

/** Brings a shared text to `value` by changing only the stretch that differs. */
export function replaceText(text: Y.Text, value: string) {
  const current = text.toString();
  if (current === value) return;
  let start = 0;
  const shortest = Math.min(current.length, value.length);
  while (start < shortest && current[start] === value[start]) start++;
  let end = 0;
  while (
    end < shortest - start &&
    current[current.length - 1 - end] === value[value.length - 1 - end]
  )
    end++;
  text.doc?.transact(() => {
    const removed = current.length - start - end;
    if (removed > 0) text.delete(start, removed);
    const added = value.slice(start, value.length - end);
    if (added) text.insert(start, added);
  }, localOrigin);
}

/** A note's map in the doc, for its shared editor. */
export function noteMap(doc: Y.Doc, noteId: string): Y.Map<unknown> | undefined {
  return notebookRoots(doc)
    .notes.toArray()
    .find((map) => map.get("id") === noteId);
}

/** Keeps a note's Markdown in step with what was typed in its shared editor. */
export function setNoteMarkdown(doc: Y.Doc, noteId: string, markdown: string) {
  const map = noteMap(doc, noteId);
  if (!map || (map.get("markdown") === markdown && !map.get("stale"))) return;
  doc.transact(() => {
    map.set("markdown", markdown);
    map.set("updatedAt", new Date().toISOString());
    map.delete("stale");
  }, editorOrigin);
}

/** The Markdown a note's editor should start from, when its shared text is empty or behind. */
export function noteSeed(map: Y.Map<unknown>): string | undefined {
  const body = map.get("body");
  const empty = !(body instanceof Y.XmlFragment) || body.length === 0;
  const markdown = String(map.get("markdown") ?? "");
  return markdown && (empty || map.get("stale")) ? markdown : undefined;
}
