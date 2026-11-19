import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { spacesGateway, type LiveDoc } from "../spaces-gateway/spacesGateway";
import {
  editorOrigin,
  isSeeded,
  localOrigin,
  makingOf,
  type MakingItem,
  mergeNotebook,
  mergeOutputs,
  notebookRoots,
  replaceText,
  takeLease,
  writeMaking,
  writeNotebook,
  writeOutputs,
} from "./notebookDoc";
import { NOTEBOOK_DOC_PREFIX, notebookFromMarkdown, notebookMarkdown } from "./notebookMarkdown";
import { agentTag } from "./agentTag";
import { personColor } from "./personTone";
import { readLink } from "./tutorSources";
import { useTutorStore } from "./tutorStore";
import type { Deck, Guide, Notebook } from "./tutorTypes";

/**
 * Keeps an open notebook in step with its Space doc, both ways: what this person changes goes
 * into the doc, and what anyone else changes comes back into their copy here (tutorStore), so the
 * panes, the AI's context and search read one notebook. Only notebooks someone has open are held.
 */

interface Held {
  live: LiveDoc;
  notebookId: string;
  me: string;
  refs: number;
  /** The notebook as last written to or read from the doc. */
  notebook: Notebook;
  outputs: { decks: Deck[]; guides: Guide[] };
  stop: (() => void)[];
  projection?: number;
  /** Links whose text this computer already asked to read. */
  read: Set<string>;
}

const held = new Map<string, Held>();
const opening = new Map<string, Promise<Held | null>>();
/** Why a notebook's live doc couldn't open, until it's tried again or opens. */
const failures = new Map<string, string>();
/** How many times each notebook's open was tried again, so its holders hold it afresh. */
const attempts = new Map<string, number>();
let mirroring = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** The live doc of an open notebook, once it's there. */
export const liveNotebook = (notebookId: string) => held.get(notebookId);

/** Why a notebook's live doc couldn't open, if it couldn't. */
export const liveNotebookError = (notebookId: string) => failures.get(notebookId);

/** Opens a notebook's live doc again after it failed to open. */
export function retryLiveNotebook(notebookId: string) {
  failures.delete(notebookId);
  attempts.set(notebookId, (attempts.get(notebookId) ?? 0) + 1);
  changed();
}

/** How long a notebook's room has to sync before its open counts as failed. */
const syncTimeoutMs = 30_000;

/** Settles once the doc has synced; fails when it's lost first or doesn't sync in time. */
function syncedInTime(live: LiveDoc): Promise<void> {
  return new Promise((resolve, reject) => {
    const lostError = () =>
      new Error(
        live.lost() === "deleted"
          ? "This notebook was deleted."
          : "You no longer have access to this notebook.",
      );
    if (live.lost()) return reject(lostError());
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      stop();
      if (error) reject(error);
      else resolve();
    };
    const timer = window.setTimeout(
      () =>
        finish(new Error("Couldn't reach the shared note. Check your connection and try again.")),
      syncTimeoutMs,
    );
    const stop = live.onLost(() => {
      if (live.lost()) finish(lostError());
    });
    void live.synced.then(() => finish());
  });
}

/** Re-renders when a notebook's live doc arrives or goes. */
export function useLiveNotebook(notebookId: string): Held | undefined {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick((count) => count + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return held.get(notebookId);
}

const outputsOf = (notebookId: string) => {
  const { decks, guides } = useTutorStore.getState();
  return {
    decks: Object.values(decks).filter((deck) => deck.notebookId === notebookId),
    guides: Object.values(guides).filter((guide) => guide.notebookId === notebookId),
  };
};

const jobsOf = (notebookId: string) =>
  Object.values(useTutorStore.getState().jobs).filter((job) => job.notebookId === notebookId);

/** Brings this computer's copy to what the doc has now. */
function mirror(entry: Held) {
  const store = useTutorStore.getState();
  const local = store.notebooks[entry.notebookId];
  if (!local) return;
  const doc = entry.live.doc;
  const next = mergeNotebook(local, doc);
  const before = outputsOf(entry.notebookId);
  const outputs = mergeOutputs(doc, entry.notebookId, before);
  mirroring = true;
  try {
    store.updateNotebook(entry.notebookId, () => next);
    const keep = new Set([...outputs.decks, ...outputs.guides].map((item) => item.id));
    for (const deck of before.decks) if (!keep.has(deck.id)) store.removeDeck(deck.id);
    for (const guide of before.guides) if (!keep.has(guide.id)) store.removeGuide(guide.id);
    for (const deck of outputs.decks) store.saveDeck(deck);
    for (const guide of outputs.guides) store.saveGuide(guide);
  } finally {
    mirroring = false;
  }
  entry.notebook = useTutorStore.getState().notebooks[entry.notebookId] ?? next;
  entry.outputs = outputsOf(entry.notebookId);
  // A teammate's link is read again here, on this person's own computer.
  for (const source of entry.notebook.sources) {
    if (source.kind !== "link" || source.text || source.reading || entry.read.has(source.id))
      continue;
    entry.read.add(source.id);
    void readLink(entry.notebookId, source).catch(() => undefined);
  }
}

/** Rewrites the doc's readable copy (what Spaces and the server's search show), from one computer. */
function scheduleProjection(entry: Held) {
  if (entry.projection) window.clearTimeout(entry.projection);
  entry.projection = window.setTimeout(() => {
    entry.projection = undefined;
    const doc = entry.live.doc;
    void takeLease(doc, "projection", entry.me, 30_000, 0).then((mine) => {
      if (!mine || !held.has(entry.notebookId)) return;
      replaceText(doc.getText("misty:title"), `${NOTEBOOK_DOC_PREFIX}${entry.notebook.title}`);
      replaceText(doc.getText("misty:markdown"), notebookMarkdown(entry.notebook));
    });
  }, 1500);
}

/** Writes what changed in this person's copy into the doc. Mirrored changes aren't written back. */
function writeChanges(entry: Held) {
  const state = useTutorStore.getState();
  const notebook = state.notebooks[entry.notebookId];
  if (!notebook || entry.live.role === "viewer") return;
  const doc = entry.live.doc;
  if (notebook !== entry.notebook) {
    writeNotebook(doc, entry.notebook, notebook, entry.me);
    entry.notebook = notebook;
    scheduleProjection(entry);
  }
  const outputs = outputsOf(entry.notebookId);
  if (
    outputs.decks.some((deck, index) => deck !== entry.outputs.decks[index]) ||
    outputs.guides.some((guide, index) => guide !== entry.outputs.guides[index]) ||
    outputs.decks.length !== entry.outputs.decks.length ||
    outputs.guides.length !== entry.outputs.guides.length
  ) {
    writeOutputs(doc, entry.outputs, outputs, entry.me);
    entry.outputs = outputs;
  }
  writeMaking(doc, jobsOf(entry.notebookId), entry.me, agentTag);
}

let watching = false;
function watchStore() {
  if (watching) return;
  watching = true;
  useTutorStore.subscribe(() => {
    if (mirroring) return;
    for (const entry of held.values()) writeChanges(entry);
  });
}

/** Puts a notebook's content into its doc the first time the doc is opened, from one computer. */
async function seed(entry: Held) {
  const doc = entry.live.doc;
  if (isSeeded(doc) || entry.live.role === "viewer") return;
  if (!(await takeLease(doc, "seed", entry.me)) || isSeeded(doc)) return;
  const local = useTutorStore.getState().notebooks[entry.notebookId];
  if (!local) return;
  const markdown = doc.getText("misty:markdown").toString();
  const fromDoc = notebookFromMarkdown(markdown);
  const empty = !local.sources.length && !local.notes.length;
  const at = new Date().toISOString();
  const start: Notebook =
    empty && (fromDoc.sources.length || fromDoc.notes.length)
      ? {
          ...local,
          sources: fromDoc.sources.map((source, index) => ({
            ...source,
            id: `source-${entry.live.doc.clientID}-${index}`,
            context: "full",
            createdAt: at,
          })),
          notes: fromDoc.notes.map((note, index) => ({
            ...note,
            id: `note-${entry.live.doc.clientID}-${index}`,
            origin: "person",
            createdAt: at,
            updatedAt: at,
          })),
        }
      : local;
  writeNotebook(doc, undefined, start, entry.me);
  writeOutputs(doc, { decks: [], guides: [] }, outputsOf(entry.notebookId), entry.me);
}

/** Takes in Markdown the server wrote into the doc (an agent's or the API's rewrite): new sources
 * and notes are added; nothing already here is removed. */
function takeRewrite(entry: Held, markdown: string) {
  const from = notebookFromMarkdown(markdown);
  const store = useTutorStore.getState();
  const notebook = store.notebooks[entry.notebookId];
  if (!notebook) return;
  const urls = new Set(notebook.sources.map((source) => source.url).filter(Boolean));
  const titles = new Set(notebook.sources.map((source) => source.title));
  for (const source of from.sources)
    if (!(source.url ? urls.has(source.url) : titles.has(source.title)))
      store.addSource(entry.notebookId, { ...source, context: "full" });
  const notes = new Set(notebook.notes.map((note) => `${note.title}\n${note.body}`));
  for (const note of from.notes)
    if (!notes.has(`${note.title}\n${note.body}`)) store.saveNote(entry.notebookId, note);
}

async function open(notebookId: string): Promise<Held | null> {
  const gateway = spacesGateway.maybe();
  const notebook = useTutorStore.getState().notebooks[notebookId];
  const me = gateway?.me();
  if (!gateway || !notebook?.space || !me) return null;
  const live = await gateway.openLiveDoc(notebook.space.spaceId, notebook.space.docId);
  const entry: Held = {
    live,
    notebookId,
    me: me.userId,
    refs: 0,
    notebook,
    outputs: outputsOf(notebookId),
    stop: [],
    read: new Set(),
  };
  try {
    await syncedInTime(live);
    live.awareness.setLocalStateField("user", {
      id: me.userId,
      name: me.name,
      color: personColor(me.userId),
    });
    await seed(entry);
    mirror(entry);
  } catch (error) {
    // A doc that never opened is let go, so trying again opens a fresh one.
    live.close();
    throw error;
  }
  let pending = 0;
  const onRemote = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
    if (transaction.origin === localOrigin) return;
    if (pending) return;
    pending = window.setTimeout(
      () => {
        pending = 0;
        if (held.get(notebookId) === entry) mirror(entry);
      },
      transaction.origin === editorOrigin ? 250 : 30,
    );
    void events;
  };
  const roots = notebookRoots(live.doc);
  for (const root of [roots.meta, roots.sources, roots.notes, roots.outputs]) {
    root.observeDeep(onRemote);
    entry.stop.push(() => root.unobserveDeep(onRemote));
  }
  entry.stop.push(live.followRewrites((markdown) => takeRewrite(entry, markdown)));
  entry.stop.push(
    live.onLost(() => {
      if (!live.lost()) return;
      // The notebook was deleted from its Space, or this person left it: it goes from here too.
      const store = useTutorStore.getState();
      const { decks, guides } = outputsOf(notebookId);
      release(notebookId, true);
      decks.forEach((deck) => store.removeDeck(deck.id));
      guides.forEach((guide) => store.removeGuide(guide.id));
      store.removeNotebook(notebookId);
    }),
  );
  watchStore();
  return entry;
}

/** What others are making in the notebook's Create pane right now. */
export function useOthersMaking(notebookId: string): (MakingItem & { id: string })[] {
  const entry = useLiveNotebook(notebookId);
  const [items, setItems] = useState<(MakingItem & { id: string })[]>([]);
  useEffect(() => {
    if (!entry) return setItems([]);
    const making = notebookRoots(entry.live.doc).making;
    const read = () => setItems(makingOf(entry.live.doc).filter((item) => item.by !== entry.me));
    read();
    making.observe(read);
    return () => making.unobserve(read);
  }, [entry]);
  return items;
}

/** Holds a notebook's live doc while it's open; `release` lets go. */
export async function hold(notebookId: string): Promise<Held | null> {
  const current = held.get(notebookId);
  if (current) {
    current.refs += 1;
    return current;
  }
  let promise = opening.get(notebookId);
  if (!promise) {
    promise = open(notebookId).finally(() => opening.delete(notebookId));
    opening.set(notebookId, promise);
  }
  const entry = await promise.catch((reason: unknown) => {
    failures.set(notebookId, reason instanceof Error ? reason.message : String(reason));
    changed();
    return null;
  });
  if (!entry) return null;
  failures.delete(notebookId);
  if (!held.has(notebookId)) held.set(notebookId, entry);
  const kept = held.get(notebookId)!;
  kept.refs += 1;
  changed();
  return kept;
}

export function release(notebookId: string, all = false) {
  const entry = held.get(notebookId);
  if (!entry) return;
  entry.refs = all ? 0 : entry.refs - 1;
  if (entry.refs > 0) return;
  held.delete(notebookId);
  if (entry.projection) window.clearTimeout(entry.projection);
  entry.stop.forEach((stop) => stop());
  entry.live.close();
  changed();
}

/** Holds the notebook's live doc while the component is on screen. */
export function useHeldNotebook(notebook: Notebook): Held | undefined {
  const entry = useLiveNotebook(notebook.id);
  const docId = notebook.space?.docId;
  // Trying a failed open again holds the notebook afresh.
  const attempt = attempts.get(notebook.id) ?? 0;
  useEffect(() => {
    if (!docId) return;
    let kept = false;
    let gone = false;
    void hold(notebook.id).then((found) => {
      kept = Boolean(found);
      if (gone && kept) release(notebook.id);
    });
    return () => {
      gone = true;
      if (kept) release(notebook.id);
    };
  }, [notebook.id, docId, attempt]);
  return entry;
}

/**
 * Lets one computer of everyone with the notebook open run `name` (its overview, a look for
 * news). A notebook nobody shares a doc for yet runs it here.
 */
export async function claimRun(notebookId: string, name: string, ms = 120_000): Promise<boolean> {
  const entry = held.get(notebookId);
  if (!entry) return !useTutorStore.getState().notebooks[notebookId]?.space;
  if (entry.live.role === "viewer") return false;
  return takeLease(entry.live.doc, name, entry.me, ms);
}
