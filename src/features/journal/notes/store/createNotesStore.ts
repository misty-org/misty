import { create } from "zustand";
import type { NativeNotesApi } from "../noteServices";
import type { NotesLoadPhase, UnifiedNote } from "../model/types";
import { mapServerNote } from "../serverNotes";

export function createNotesStore(services: {
  api: Pick<NativeNotesApi, "list" | "create" | "remove">;
  closeCollaboration: () => void;
}) {
  const { api, closeCollaboration } = services;
  let notesLoadGeneration = 0;

  const listSpaceNotes = async (spaceId: string, spaceName: string) =>
    (await api.list(spaceId)).notes.map((note) => mapServerNote(note, spaceName));

  const useNotesStore = create<NotesStore>((set, get) => ({
    phase: "idle",
    notes: [],
    error: undefined,
    selectedNoteId: undefined,
    accountId: undefined,
    spaceId: undefined,
    spaceName: undefined,
    query: "",

    async load(accountId: string, spaceId: string, spaceName: string) {
      const state = get();
      const sameScope = state.accountId === accountId && state.spaceId === spaceId;
      if (sameScope && state.phase === "ready") return;

      const generation = ++notesLoadGeneration;
      set({
        phase: "loading",
        accountId,
        spaceId,
        spaceName,
        notes: [],
        selectedNoteId: undefined,
        error: undefined,
      });
      try {
        const notes = await listSpaceNotes(spaceId, spaceName);
        if (generation !== notesLoadGeneration) return;
        set({ phase: "ready", notes, selectedNoteId: notes[0]?.id });
      } catch (reason) {
        if (generation !== notesLoadGeneration) return;
        // A failed list keeps the section calm: no notes and an inline notice.
        set({ phase: "ready", error: errorMessage(reason) });
      }
    },

    async refresh() {
      const { spaceId, spaceName } = get();
      if (!spaceId) return;
      const generation = notesLoadGeneration;
      try {
        const notes = await listSpaceNotes(spaceId, spaceName ?? "");
        if (generation !== notesLoadGeneration) return;
        set((state) => ({
          notes,
          error: undefined,
          selectedNoteId: notes.some((note) => note.id === state.selectedNoteId)
            ? state.selectedNoteId
            : notes[0]?.id,
        }));
      } catch (reason) {
        if (generation !== notesLoadGeneration) return;
        set({ error: errorMessage(reason) });
      }
    },

    setQuery(query: string) {
      set({ query });
    },

    selectNote(selectedNoteId) {
      set({ selectedNoteId });
    },

    async createNote(input) {
      const { spaceId, spaceName } = get();
      if (!spaceId || !spaceName) {
        set({ error: "Open a Space before creating a note." });
        return undefined;
      }
      const generation = notesLoadGeneration;
      try {
        const created = mapServerNote(
          await api.create(spaceId, input.title.trim() || "Untitled note"),
          spaceName,
        );
        if (generation !== notesLoadGeneration) return undefined;
        set((state) => ({
          notes: [created, ...state.notes],
          selectedNoteId: created.id,
          query: "",
        }));
        return created;
      } catch (reason) {
        if (generation !== notesLoadGeneration) return undefined;
        set({ error: errorMessage(reason) });
        return undefined;
      }
    },

    async deleteNote(noteId: string) {
      const note = get().notes.find((candidate) => candidate.id === noteId);
      if (!note) return;
      if (!note.spaceId) throw new Error("Open the note's Space before deleting it.");
      const generation = notesLoadGeneration;
      try {
        await api.remove(note.spaceId, note.sourceId);
        if (generation !== notesLoadGeneration) return;
        closeCollaboration();
        set((state) => {
          const deletedIndex = state.notes.findIndex((candidate) => candidate.id === noteId);
          const notes = state.notes.filter((candidate) => candidate.id !== noteId);
          const nextSelectedNoteId =
            state.selectedNoteId === noteId
              ? (notes[deletedIndex] ?? notes[deletedIndex - 1] ?? notes[0])?.id
              : state.selectedNoteId;
          return { notes, selectedNoteId: nextSelectedNoteId };
        });
      } catch (reason) {
        if (generation !== notesLoadGeneration) return;
        set({ error: errorMessage(reason) });
        throw reason;
      }
    },
  }));

  function resetNotesAccountState(): void {
    closeCollaboration();
    notesLoadGeneration += 1;
    useNotesStore.setState({
      phase: "idle",
      notes: [],
      error: undefined,
      selectedNoteId: undefined,
      accountId: undefined,
      spaceId: undefined,
      spaceName: undefined,
      query: "",
    });
  }

  return { useStore: useNotesStore, reset: resetNotesAccountState };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Misty could not update this note.";
}

interface NotesStoreState {
  phase: NotesLoadPhase;
  notes: UnifiedNote[];
  /** A present message renders a calm inline notice. */
  error?: string;
  selectedNoteId?: string;
  /** Account whose notes are loaded. */
  accountId?: string;
  /** The Space whose Notes section is mounted; new notes go into it. */
  spaceId?: string;
  spaceName?: string;
  query: string;
}

interface NotesStoreActions {
  load: (accountId: string, spaceId: string, spaceName: string) => Promise<void>;
  refresh: () => Promise<void>;
  setQuery: (query: string) => void;
  selectNote: (noteId: string | undefined) => void;
  createNote: (input: { title: string; body: string }) => Promise<UnifiedNote | undefined>;
  deleteNote: (noteId: string) => Promise<void>;
}

export type NotesStore = NotesStoreState & NotesStoreActions;
