import { embedOnDevice, queryVector } from "@/api/runtime/device-embeddings";
import { localChats } from "../conversations/state/localChats";
import { notebookContext, passagesContext } from "./tutorPrompts";
import { useTutorStore } from "./tutorStore";
import type { Notebook } from "./tutorTypes";

/**
 * Search across every notebook. With an embedding model on this computer it searches by meaning:
 * each notebook's sources and notes are cut into passages, embedded on the device, and the vectors
 * kept in misty.db beside the notebook, so only new or changed passages are embedded again.
 * Without one it matches words.
 */

interface Passage {
  /** Where it is: a source or a note of a notebook. */
  notebookId: string;
  kind: "source" | "note";
  itemId: string;
  title: string;
  text: string;
}

interface Indexed extends Passage {
  hash: string;
  vector: number[];
}

interface NotebookIndex {
  id: string;
  model: string;
  passages: Indexed[];
}

export interface SearchHit extends Passage {
  score: number;
}

const size = 1200;
const overlap = 200;
const perNotebook = 300;

/** The text cut into overlapping passages at paragraph or sentence ends where it can. */
export function passagesOf(text: string): string[] {
  const clean = text.replace(/\r/g, "").trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
      if (cut > size / 2) end = start + cut + 1;
    }
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

function notebookPassages(notebook: Notebook): Passage[] {
  const passages: Passage[] = [];
  for (const source of notebook.sources) {
    const text =
      source.text || source.summary || [source.title, source.url].filter(Boolean).join(" ");
    for (const part of passagesOf(text))
      passages.push({
        notebookId: notebook.id,
        kind: "source",
        itemId: source.id,
        title: source.title,
        text: part,
      });
  }
  for (const note of notebook.notes)
    for (const part of passagesOf(`${note.title}\n\n${note.body}`))
      passages.push({
        notebookId: notebook.id,
        kind: "note",
        itemId: note.id,
        title: note.title,
        text: part,
      });
  return passages.slice(0, perNotebook);
}

/** A short stable fingerprint of a passage, to tell which ones changed. */
export function hashOf(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = (hash * 33) ^ text.charCodeAt(index);
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length && index < b.length; index++) {
    dot += a[index] * b[index];
    left += a[index] * a[index];
    right += b[index] * b[index];
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

/** The notebook's passages with vectors from `model`, embedding only the ones it lacks. */
async function indexOf(account: string, notebook: Notebook, model: string): Promise<Indexed[]> {
  const saved = (
    await localChats.tutor<NotebookIndex>(account, "tutor_index").catch(() => [])
  ).find((index) => index.id === notebook.id);
  const known = new Map(
    (saved?.model === model ? saved.passages : []).map((passage) => [passage.hash, passage.vector]),
  );
  const passages = notebookPassages(notebook).map((passage) => ({
    ...passage,
    hash: hashOf(passage.text),
  }));
  const missing = passages.filter((passage) => !known.has(passage.hash));
  for (let at = 0; at < missing.length; at += 32) {
    const batch = missing.slice(at, at + 32);
    const { embeddings } = await embedOnDevice(batch.map((passage) => passage.text));
    batch.forEach((passage, index) => {
      if (embeddings[index]) known.set(passage.hash, embeddings[index]);
    });
  }
  const indexed = passages.flatMap((passage) => {
    const vector = known.get(passage.hash);
    return vector ? [{ ...passage, vector }] : [];
  });
  if (missing.length || !saved || saved.passages.length !== indexed.length) {
    const index: NotebookIndex = { id: notebook.id, model, passages: indexed };
    await localChats.saveTutor(account, "tutor_index", index).catch(() => undefined);
  }
  return indexed;
}

function wordSearch(query: string, notebooks: Notebook[]): SearchHit[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  if (!words.length) return [];
  return notebooks
    .flatMap(notebookPassages)
    .map((passage) => {
      const text = passage.text.toLowerCase();
      const found = words.filter((word) => text.includes(word)).length;
      return { ...passage, score: found / words.length };
    })
    .filter((hit) => hit.score > 0);
}

/** The best passages across all notebooks, and whether they were found by meaning. */
export async function searchNotebooks(
  query: string,
  signal?: AbortSignal,
): Promise<{ hits: SearchHit[]; byMeaning: boolean }> {
  const { accountId, notebooks } = useTutorStore.getState();
  const all = Object.values(notebooks);
  const found = await queryVector(query, signal);
  let hits: SearchHit[];
  let byMeaning = false;
  if (found) {
    try {
      const indexed = (
        await Promise.all(all.map((notebook) => indexOf(accountId, notebook, found.model)))
      ).flat();
      hits = indexed.map(({ vector, hash: _hash, ...passage }) => ({
        ...passage,
        score: cosine(found.vector, vector),
      }));
      byMeaning = true;
    } catch {
      hits = wordSearch(query, all);
    }
  } else hits = wordSearch(query, all);
  signal?.throwIfAborted();
  // One hit per item: its best passage.
  const best = new Map<string, SearchHit>();
  for (const hit of hits.sort((a, b) => b.score - a.score)) {
    const key = `${hit.notebookId}:${hit.itemId}`;
    if (!best.has(key)) best.set(key, hit);
  }
  return { hits: [...best.values()].slice(0, 12), byMeaning };
}

/** Under this, a question sends every included source whole; over it, only the passages it needs. */
const wholeLimit = 60_000;

/**
 * The sources a question about a notebook sends: all of them when they fit, otherwise the twelve
 * passages that bear on it most, by meaning when there is an embedding model, by words otherwise.
 */
export async function questionContext(notebook: Notebook, question: string): Promise<string> {
  const whole = notebookContext(notebook);
  if (whole.length <= wholeLimit) return whole;
  const included = {
    ...notebook,
    sources: notebook.sources.filter((source) => source.context !== "off"),
    notes: [],
  };
  const keep = new Set(included.sources.map((source) => source.id));
  let ranked: SearchHit[] = [];
  const found = await queryVector(question);
  if (found) {
    try {
      const { accountId } = useTutorStore.getState();
      ranked = (await indexOf(accountId, notebook, found.model))
        .filter((passage) => passage.kind === "source" && keep.has(passage.itemId))
        .map(({ vector, hash: _hash, ...passage }) => ({
          ...passage,
          score: cosine(found.vector, vector),
        }));
    } catch {
      ranked = [];
    }
  }
  if (!ranked.length) ranked = wordSearch(question, [included]);
  const top = ranked.sort((a, b) => b.score - a.score).slice(0, 12);
  return passagesContext(notebook, top);
}
