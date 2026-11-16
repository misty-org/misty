import { useEffect, useState } from "react";
import * as Y from "yjs";
import { runOnEngine } from "../engines/engineRun";
import { spacesGateway, type DocVisibility, type LiveDoc } from "../spaces-gateway/spacesGateway";
import { notebookRoots, replaceText } from "./notebookDoc";
import { liveNotebook, useLiveNotebook } from "./notebookLive";
import { askPrompt } from "./tutorPrompts";
import { questionContext } from "./tutorSearch";
import type { Notebook } from "./tutorTypes";

/**
 * A person's questions about a notebook and their engine's answers: a Space note of their own,
 * private until they share it, so it's there wherever they sign in and teammates can watch a
 * shared one live. It holds `qa:turns` (each question, its answer as it's written, its state and
 * the sources its "[n]" point at) and `qa:meta` (which notebook, whether it's a lesson, whose).
 * The notebook's own doc lists each person's threads under `lab:meta` `threads:<userId>`, the
 * current one last. Nothing here is an agent chat.
 */

export const THREAD_DOC_PREFIX = "Questions: ";
export type TurnState = "asking" | "answering" | "done" | "failed";

export interface Turn {
  id: string;
  question: string;
  answer: string;
  state: TurnState;
  /** The source ids in the order the question numbered them. */
  cites: string[];
  error?: string;
  askedAt: string;
}

export interface ThreadMeta {
  notebookDocId: string;
  style: "default" | "lesson";
  ownerId: string;
}

const origin = "qa-local";
const roots = (doc: Y.Doc) => ({
  turns: doc.getArray<Y.Map<unknown>>("qa:turns"),
  meta: doc.getMap<unknown>("qa:meta"),
});

/** The thread's turns, oldest first. */
export function readTurns(doc: Y.Doc): Turn[] {
  return roots(doc)
    .turns.toArray()
    .map((map) => {
      const turn = map.toJSON() as Partial<Turn>;
      return {
        id: String(turn.id ?? ""),
        question: String(turn.question ?? ""),
        answer: String(turn.answer ?? ""),
        state: (turn.state ?? "done") as TurnState,
        cites: Array.isArray(turn.cites) ? (turn.cites as string[]) : [],
        error: turn.error ? String(turn.error) : undefined,
        askedAt: String(turn.askedAt ?? ""),
      };
    });
}

export const readMeta = (doc: Y.Doc) => roots(doc).meta.toJSON() as Partial<ThreadMeta>;

/** The thread as Markdown, the note's readable copy in Spaces and the server's search. */
function threadMarkdown(turns: readonly Turn[]): string {
  return turns
    .filter((turn) => turn.answer)
    .map((turn) => `**${turn.question.replace(/\s+/g, " ").trim()}**\n\n${turn.answer.trim()}`)
    .join("\n\n---\n\n");
}

// ---- Rooms --------------------------------------------------------------------------------------

interface Held {
  live: LiveDoc;
  refs: number;
}
const held = new Map<string, Held>();
const opening = new Map<string, Promise<LiveDoc>>();

/** Holds a thread's room; `letGo` releases it. */
async function holdThread(spaceId: string, docId: string): Promise<LiveDoc> {
  const known = held.get(docId);
  if (known) {
    known.refs += 1;
    return known.live;
  }
  let promise = opening.get(docId);
  if (!promise) {
    promise = spacesGateway
      .get()
      .openLiveDoc(spaceId, docId)
      .then(async (live) => {
        await live.synced;
        return live;
      })
      .finally(() => opening.delete(docId));
    opening.set(docId, promise);
  }
  const live = await promise;
  const entry = held.get(docId) ?? { live, refs: 0 };
  entry.refs += 1;
  held.set(docId, entry);
  return entry.live;
}

function letGo(docId: string) {
  const entry = held.get(docId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  held.delete(docId);
  entry.live.close();
}

/** A thread live, read as it changes: the person's own, or a teammate's shared one. */
export function useThread(spaceId: string | undefined, docId: string | undefined) {
  const [state, setState] = useState<{ turns: Turn[]; meta: Partial<ThreadMeta>; doc?: Y.Doc }>({
    turns: [],
    meta: {},
  });
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    setState({ turns: [], meta: {} });
    setUnreachable(false);
    if (!spaceId || !docId) return;
    let live: LiveDoc | undefined;
    let gone = false;
    const read = () =>
      live && setState({ turns: readTurns(live.doc), meta: readMeta(live.doc), doc: live.doc });
    void holdThread(spaceId, docId)
      .then((opened) => {
        if (gone) return letGo(docId);
        live = opened;
        read();
        roots(opened.doc).turns.observeDeep(read);
        roots(opened.doc).meta.observe(read);
      })
      // Someone else's private thread can't be opened: it isn't shown.
      .catch(() => !gone && setUnreachable(true));
    return () => {
      gone = true;
      if (!live) return;
      roots(live.doc).turns.unobserveDeep(read);
      roots(live.doc).meta.unobserve(read);
      letGo(docId);
    };
  }, [spaceId, docId]);
  return { ...state, unreachable };
}

// ---- Which threads a notebook has ---------------------------------------------------------------

const threadsKey = (userId: string) => `threads:${userId}`;

/** Each person's threads in the notebook, by user id, the current one last. */
function threadsOf(notebookId: string): Record<string, string[]> {
  const entry = liveNotebook(notebookId);
  if (!entry) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of notebookRoots(entry.live.doc).meta.entries())
    if (key.startsWith("threads:") && Array.isArray(value))
      out[key.slice("threads:".length)] = value as string[];
  return out;
}

/** The notebook's thread lists, as they change. */
function useThreadLists(notebookId: string): Record<string, string[]> {
  const entry = useLiveNotebook(notebookId);
  const [lists, setLists] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!entry) return setLists({});
    const meta = notebookRoots(entry.live.doc).meta;
    const read = () => setLists(threadsOf(notebookId));
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [entry, notebookId]);
  return lists;
}

/** The person's current thread in a notebook, its layer, and how to share it or start anew. */
export function useMyThread(notebook: Notebook) {
  const entry = useLiveNotebook(notebook.id);
  const lists = useThreadLists(notebook.id);
  const docId = entry ? lists[entry.me]?.at(-1) : undefined;
  const thread = useThread(notebook.space?.spaceId, docId);
  const [visibility, setVisibility] = useState<DocVisibility>("private");
  useEffect(() => {
    const spaceId = notebook.space?.spaceId;
    if (!spaceId || !docId) return setVisibility("private");
    let current = true;
    void spacesGateway
      .maybe()
      ?.docVisibility(spaceId, docId)
      .then((found) => current && found && setVisibility(found));
    return () => {
      current = false;
    };
  }, [notebook.space?.spaceId, docId]);
  return {
    docId,
    ...thread,
    visibility,
    async share(next: DocVisibility) {
      const spaceId = notebook.space?.spaceId;
      if (!spaceId || !docId) return;
      setVisibility(next);
      await spacesGateway.get().setDocVisibility(spaceId, docId, next);
    },
    /** The next question starts a new thread. */
    startNew: () => startThread(notebook, "default"),
  };
}

/** Teammates whose current thread in the notebook is shared, so it can be watched. */
export function useSharedThreads(notebook: Notebook) {
  const entry = useLiveNotebook(notebook.id);
  const lists = useThreadLists(notebook.id);
  const [shared, setShared] = useState<{ userId: string; docId: string }[]>([]);
  const spaceId = notebook.space?.spaceId;
  const latest = Object.entries(lists)
    .filter(([userId]) => userId !== entry?.me)
    .map(([userId, docs]) => ({ userId, docId: docs.at(-1) ?? "" }))
    .filter((item) => item.docId);
  const key = latest.map((item) => `${item.userId}:${item.docId}`).join(",");
  useEffect(() => {
    if (!spaceId || !latest.length) return setShared([]);
    let current = true;
    const check = () =>
      void Promise.all(
        latest.map(async (item) =>
          (await spacesGateway.maybe()?.docVisibility(spaceId, item.docId)) === "public"
            ? item
            : null,
        ),
      ).then((found) => current && setShared(found.filter(Boolean) as typeof latest));
    check();
    // A teammate sharing or hiding theirs shows up within a minute, or as soon as a doc changes.
    const timer = window.setInterval(check, 60_000);
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (!detail?.space_id || detail.space_id === spaceId) check();
    };
    window.addEventListener("misty:space-note-event", onEvent);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener("misty:space-note-event", onEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, key]);
  return shared;
}

// ---- Asking ------------------------------------------------------------------------------------

/** Makes a new thread for the person in this notebook: a private Space note of theirs. */
async function startThread(notebook: Notebook, style: ThreadMeta["style"]): Promise<string> {
  const entry = liveNotebook(notebook.id);
  const gateway = spacesGateway.get();
  if (!notebook.space || !entry) throw new Error("This notebook isn't open in its Space yet.");
  const { id } = await gateway.createDoc(
    notebook.space.spaceId,
    `${THREAD_DOC_PREFIX}${notebook.title}`,
    "",
    "private",
  );
  const live = await holdThread(notebook.space.spaceId, id);
  live.doc.transact(() => {
    const meta = roots(live.doc).meta;
    meta.set("notebookDocId", notebook.space!.docId);
    meta.set("style", style);
    meta.set("ownerId", entry.me);
  }, origin);
  letGo(id);
  const meta = notebookRoots(entry.live.doc).meta;
  const mine = (meta.get(threadsKey(entry.me)) as string[] | undefined) ?? [];
  entry.live.doc.transact(() => meta.set(threadsKey(entry.me), [...mine, id].slice(-50)));
  return id;
}

/** The person's current thread's id, made now when they have none. */
async function currentThread(notebook: Notebook): Promise<string> {
  const entry = liveNotebook(notebook.id);
  const docId = entry ? threadsOf(notebook.id)[entry.me]?.at(-1) : undefined;
  return docId ?? startThread(notebook, "default");
}

/**
 * Asks the default engine about the notebook in the person's thread: the turn appears at once,
 * its answer streams into it for anyone watching, and the earlier turns go along as history.
 * `shown` is what the thread says was asked when the prompt itself is longer (a lesson's start).
 */
export async function askInThread(
  notebook: Notebook,
  input: { question: string; shown?: string; prompt?: string; threadId?: string },
): Promise<void> {
  const spaceId = notebook.space?.spaceId;
  if (!spaceId) throw new Error("This notebook isn't open in its Space yet.");
  const threadId = input.threadId ?? (await currentThread(notebook));
  const live = await holdThread(spaceId, threadId);
  try {
    const { turns, meta } = roots(live.doc);
    const earlier = readTurns(live.doc).filter((turn) => turn.state === "done" && turn.answer);
    const lesson = (meta.get("style") as string | undefined) === "lesson";
    const turnId = `turn-${crypto.randomUUID()}`;
    const map = new Y.Map<unknown>();
    live.doc.transact(() => {
      map.set("id", turnId);
      map.set("question", input.shown ?? input.question);
      map.set("answer", "");
      map.set("state", "asking");
      map.set(
        "cites",
        notebook.sources.map((source) => source.id),
      );
      map.set("askedAt", new Date().toISOString());
      turns.push([map]);
    }, origin);
    const styled = lesson
      ? {
          ...notebook,
          chatStyle: { goal: "guide" as const, length: notebook.chatStyle?.length ?? "default" },
        }
      : notebook;
    const prompt =
      input.prompt ??
      askPrompt(styled, input.question, await questionContext(notebook, input.question));
    let written = 0;
    const write = (text: string, force = false) => {
      if (!force && Date.now() - written < 300) return;
      written = Date.now();
      live.doc.transact(() => {
        map.set("answer", text);
        if (map.get("state") === "asking") map.set("state", "answering");
      }, origin);
    };
    const result = await runOnEngine({
      prompt,
      key: `ask_${turnId}`,
      spaceId,
      history: earlier.map((turn) => ({
        prompt: turn.question,
        reply: turn.answer,
        at: turn.askedAt,
      })),
      onText: (text) => write(text),
    }).catch((error: unknown) => ({
      runId: "",
      text: "",
      error: error instanceof Error ? error.message : String(error),
    }));
    live.doc.transact(() => {
      map.set("answer", result.text);
      map.set("state", result.error && !result.text ? "failed" : "done");
      if (result.error && !result.text) map.set("error", result.error);
    }, origin);
    replaceText(live.doc.getText("misty:title"), `${THREAD_DOC_PREFIX}${notebook.title}`);
    replaceText(live.doc.getText("misty:markdown"), threadMarkdown(readTurns(live.doc)));
  } finally {
    letGo(threadId);
  }
}

/**
 * Teach me: a new thread that teaches step by step, its first turn `firstPrompt` (the notebook's
 * context and what to teach), shown as `shown`.
 */
export async function startLesson(notebook: Notebook, firstPrompt: string, shown: string) {
  const threadId = await startThread(notebook, "lesson");
  await askInThread(notebook, { question: shown, shown, prompt: firstPrompt, threadId });
}
