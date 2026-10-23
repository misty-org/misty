import { notesApi } from "@/api/notes/api";
import { createNotesStore } from "./createNotesStore";
const notes = createNotesStore({
  api: notesApi,
  closeCollaboration: () => {
    if (typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("misty:note-collaboration-close-all"));
  },
});
export const useNotesStore = notes.useStore;
export const resetNotesAccountState = notes.reset;
