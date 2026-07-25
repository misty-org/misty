import type { NotesPanelSidebarProps } from "@/models/interfaces/features/notes/SpaceNotes";
export type { NotesPanelSidebarProps } from "@/models/interfaces/features/notes/SpaceNotes";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useNotesStore } from "@/stores/notes";
import { selectVisibleNotes } from "@/features/notes/noteFilters";
import { NoteListPanel } from "./NoteListPanel";
import { NewNoteDialog } from "./NewNoteDialog";

export function NotesPanelSidebar(props: NotesPanelSidebarProps) {
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const store = useNotesStore(
    useShallow((state) => ({
      phase: state.phase,
      notes: state.notes,
      query: state.query,
      selectedNoteId: state.selectedNoteId,
      connectorErrors: state.connectorErrors,
    })),
  );
  const actions = useNotesStore(
    useShallow((state) => ({
      setQuery: state.setQuery,
      selectNote: state.selectNote,
      createNote: state.createNote,
    })),
  );

  const loading = store.phase === "loading" || store.phase === "idle";
  const visibleNotes = useMemo(
    () => selectVisibleNotes(store.notes, store.query, Date.now(), props.spaceId),
    [store.notes, store.query, props.spaceId],
  );

  return (
    <>
      <NoteListPanel
        notes={visibleNotes}
        query={store.query}
        loading={loading}
        spaceName={props.spaceName}
        selectedNoteId={store.selectedNoteId}
        connectorErrors={store.connectorErrors}
        onSelectNote={actions.selectNote}
        onNewNote={() => setNewNoteOpen(true)}
        onClearQuery={() => actions.setQuery("")}
      />
      <NewNoteDialog
        open={newNoteOpen}
        onOpenChange={setNewNoteOpen}
        onCreate={async (input) => {
          await actions.createNote(input);
        }}
      />
    </>
  );
}
