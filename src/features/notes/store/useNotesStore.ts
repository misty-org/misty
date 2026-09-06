import { notesApi } from "@/api/notes/api";
import { createDefaultNotesRegistry } from "../connectors/registry";
import { createNotesStore } from "./createNotesStore";
export type {
  NotesStore,
  NotesStoreState,
  NotesStoreActions,
  UpdateNoteContentInput,
} from "./createNotesStore";

const notes = createNotesStore({
  createRegistry: createDefaultNotesRegistry,
  archive: (spaceId, noteId) => notesApi.archive(spaceId, noteId),
  closeCollaboration: () => {
    if (typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("misty:note-collaboration-close-all"));
  },
});
export const useNotesStore = notes.useStore;
export const resetNotesAccountState = notes.reset;
