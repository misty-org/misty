import { useMemo } from "react";
import { create } from "zustand";
import { useLessonStore } from "./lessons/lessonStore";
import { localChats, type TutorKind } from "../conversations/state/localChats";
import { newReview, schedule, type Grade } from "./spacedReview";
import type {
  Deck,
  Flashcard,
  Guide,
  Notebook,
  NotebookNote,
  NotebookSource,
  TutorJob,
} from "./tutorTypes";

type Records<T> = Record<string, T>;

interface TutorStore {
  accountId: string;
  ready: boolean;
  notebooks: Records<Notebook>;
  decks: Records<Deck>;
  guides: Records<Guide>;
  jobs: Records<TutorJob>;
  load(accountId: string): Promise<void>;

  createNotebook(title: string): Notebook;
  updateNotebook(id: string, change: (notebook: Notebook) => Notebook): void;
  removeNotebook(id: string): void;
  addSource(notebookId: string, source: Omit<NotebookSource, "id" | "createdAt">): NotebookSource;
  updateSource(notebookId: string, sourceId: string, change: Partial<NotebookSource>): void;
  removeSource(notebookId: string, sourceId: string): void;
  saveNote(
    notebookId: string,
    note: Partial<NotebookNote> & Pick<NotebookNote, "title" | "body">,
  ): NotebookNote;
  removeNote(notebookId: string, noteId: string): void;

  saveDeck(deck: Deck): void;
  /** A deck from front and back pairs, every card due now. */
  newDeck(
    input: Pick<Deck, "title" | "notebookId" | "conversationId">,
    cards: { front: string; back: string }[],
  ): Deck;
  addCards(deckId: string, cards: { front: string; back: string }[]): void;
  updateCard(deckId: string, cardId: string, change: Pick<Flashcard, "front" | "back">): void;
  removeCard(deckId: string, cardId: string): void;
  grade(deckId: string, cardId: string, grade: Grade): void;
  removeDeck(id: string): void;

  saveGuide(guide: Guide): void;
  removeGuide(id: string): void;

  saveJob(job: TutorJob): void;
  removeJob(id: string): void;
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Tutor's notebooks, decks, guides and runs on this computer (tutorTypes.ts). */
export const useTutorStore = create<TutorStore>((set, get) => {
  const persist = <T extends { id: string }>(kind: TutorKind, item: T) =>
    void localChats.saveTutor(get().accountId, kind, item).catch(() => undefined);
  const drop = (kind: TutorKind, itemId: string) =>
    void localChats.deleteTutor(get().accountId, kind, itemId).catch(() => undefined);

  const putNotebook = (notebook: Notebook) => {
    set({ notebooks: { ...get().notebooks, [notebook.id]: notebook } });
    persist("tutor_notebook", notebook);
  };
  const changeNotebook = (notebookId: string, change: (notebook: Notebook) => Notebook) => {
    const notebook = get().notebooks[notebookId];
    if (notebook) putNotebook({ ...change(notebook), updatedAt: now() });
  };
  const putDeck = (deck: Deck) => {
    set({ decks: { ...get().decks, [deck.id]: deck } });
    persist("tutor_deck", deck);
  };
  const changeDeck = (deckId: string, change: (deck: Deck) => Deck) => {
    const deck = get().decks[deckId];
    if (deck) putDeck({ ...change(deck), updatedAt: now() });
  };
  const cardsOf = (pairs: { front: string; back: string }[]): Flashcard[] => {
    const at = new Date();
    return pairs
      .filter((pair) => pair.front.trim() && pair.back.trim())
      .map((pair) => ({
        id: id("card"),
        front: pair.front.trim(),
        back: pair.back.trim(),
        review: newReview(at),
      }));
  };

  return {
    accountId: "",
    ready: false,
    notebooks: {},
    decks: {},
    guides: {},
    jobs: {},
    async load(accountId) {
      if (get().accountId === accountId && get().ready) return;
      set({ accountId, ready: false, notebooks: {}, decks: {}, guides: {}, jobs: {} });
      const read = <T extends { id: string }>(kind: TutorKind) =>
        localChats
          .tutor<T>(accountId, kind)
          .catch(() => [] as T[])
          .then((items) => Object.fromEntries(items.map((item) => [item.id, item])));
      const [notebooks, decks, guides, jobs] = await Promise.all([
        read<Notebook>("tutor_notebook"),
        read<Deck>("tutor_deck"),
        read<Guide>("tutor_guide"),
        read<TutorJob>("tutor_job"),
      ]);
      if (get().accountId !== accountId) return;
      set({ notebooks, decks, guides, jobs, ready: true });
    },

    createNotebook(title) {
      const at = now();
      const notebook: Notebook = {
        id: id("notebook"),
        title: title.trim() || "Untitled notebook",
        sources: [],
        notes: [],
        transformations: [],
        chats: [],
        createdAt: at,
        updatedAt: at,
      };
      putNotebook(notebook);
      return notebook;
    },
    updateNotebook: changeNotebook,
    removeNotebook(notebookId) {
      const { [notebookId]: removed, ...rest } = get().notebooks;
      if (!removed) return;
      set({ notebooks: rest });
      drop("tutor_notebook", notebookId);
      drop("tutor_index", notebookId);
    },
    addSource(notebookId, input) {
      const source: NotebookSource = { ...input, id: id("source"), createdAt: now() };
      changeNotebook(notebookId, (notebook) => ({
        ...notebook,
        sources: [...notebook.sources, source],
      }));
      return source;
    },
    updateSource(notebookId, sourceId, change) {
      changeNotebook(notebookId, (notebook) => ({
        ...notebook,
        sources: notebook.sources.map((source) =>
          source.id === sourceId ? { ...source, ...change } : source,
        ),
      }));
    },
    removeSource(notebookId, sourceId) {
      changeNotebook(notebookId, (notebook) => ({
        ...notebook,
        sources: notebook.sources.filter((source) => source.id !== sourceId),
      }));
    },
    saveNote(notebookId, input) {
      const at = now();
      const existing = input.id
        ? get().notebooks[notebookId]?.notes.find((note) => note.id === input.id)
        : undefined;
      const note: NotebookNote = {
        origin: "person",
        createdAt: at,
        ...existing,
        ...input,
        id: existing?.id ?? id("note"),
        updatedAt: at,
      };
      changeNotebook(notebookId, (notebook) => ({
        ...notebook,
        notes: existing
          ? notebook.notes.map((item) => (item.id === note.id ? note : item))
          : [note, ...notebook.notes],
      }));
      return note;
    },
    removeNote(notebookId, noteId) {
      changeNotebook(notebookId, (notebook) => ({
        ...notebook,
        notes: notebook.notes.filter((note) => note.id !== noteId),
      }));
    },

    saveDeck: putDeck,
    newDeck(input, pairs) {
      const at = now();
      const deck: Deck = {
        ...input,
        id: id("deck"),
        title: input.title.trim() || "Flashcards",
        cards: cardsOf(pairs),
        createdAt: at,
        updatedAt: at,
      };
      putDeck(deck);
      return deck;
    },
    addCards(deckId, pairs) {
      changeDeck(deckId, (deck) => ({ ...deck, cards: [...deck.cards, ...cardsOf(pairs)] }));
    },
    updateCard(deckId, cardId, change) {
      changeDeck(deckId, (deck) => ({
        ...deck,
        cards: deck.cards.map((card) => (card.id === cardId ? { ...card, ...change } : card)),
      }));
    },
    removeCard(deckId, cardId) {
      changeDeck(deckId, (deck) => ({
        ...deck,
        cards: deck.cards.filter((card) => card.id !== cardId),
      }));
    },
    grade(deckId, cardId, grade) {
      const at = new Date();
      changeDeck(deckId, (deck) => ({
        ...deck,
        cards: deck.cards.map((card) =>
          card.id === cardId ? { ...card, review: schedule(card.review, grade, at) } : card,
        ),
      }));
    },
    removeDeck(deckId) {
      const { [deckId]: removed, ...rest } = get().decks;
      if (!removed) return;
      set({ decks: rest });
      drop("tutor_deck", deckId);
    },

    saveGuide(guide) {
      set({ guides: { ...get().guides, [guide.id]: guide } });
      persist("tutor_guide", guide);
    },
    removeGuide(guideId) {
      const { [guideId]: removed, ...rest } = get().guides;
      if (!removed) return;
      set({ guides: rest });
      drop("tutor_guide", guideId);
    },

    saveJob(job) {
      set({ jobs: { ...get().jobs, [job.id]: job } });
      persist("tutor_job", job);
    },
    removeJob(jobId) {
      const { [jobId]: removed, ...rest } = get().jobs;
      if (!removed) return;
      set({ jobs: rest });
      drop("tutor_job", jobId);
    },
  };
});

/** Chats that Tutor's runs and notebooks made: Tutor lists them, so the sidebar doesn't. */
export function tutorChatIds(
  jobs: Records<TutorJob>,
  notebooks: Records<Notebook> = {},
): Set<string> {
  return new Set([
    ...Object.values(jobs).map((job) => job.conversationId),
    ...Object.values(notebooks).flatMap((notebook) => notebook.chats),
  ]);
}

/** Chats Tutor keeps for itself (lessons, notebook questions, studio runs): lists of chats skip them. */
export function useTutorChatIds(): Set<string> {
  const jobs = useTutorStore((state) => state.jobs);
  const notebooks = useTutorStore((state) => state.notebooks);
  const lessons = useLessonStore((state) => state.lessons);
  return useMemo(() => {
    const ids = tutorChatIds(jobs, notebooks);
    for (const id of Object.keys(lessons)) ids.add(id);
    return ids;
  }, [jobs, notebooks, lessons]);
}
