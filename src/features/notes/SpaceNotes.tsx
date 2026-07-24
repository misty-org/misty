import type { SpaceNotesProps } from "@/models/interfaces/features/notes/SpaceNotes";
export type { SpaceNotesProps } from "@/models/interfaces/features/notes/SpaceNotes";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { useNotesStore } from "@/stores/notes";
import { NotesTopBar } from "./components/NotesTopBar";
import { NoteReadingPane } from "./components/NoteReadingPane";
import { NoteContextPanel } from "./components/NoteContextPanel";
import { NewNoteDialog } from "./components/NewNoteDialog";

const shellClass =
  "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground";

const bodyClass = "grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden";

const bodyWithContextClass =
  "grid min-h-0 overflow-hidden grid-cols-[minmax(0,1fr)_248px] max-[1100px]:grid-cols-[minmax(0,1fr)]";

export function SpaceNotes(props: SpaceNotesProps) {
  const { user } = useAuth();

  const store = useNotesStore(
    useShallow((state) => ({
      phase: state.phase,
      notes: state.notes,
      connectorErrors: state.connectorErrors,
      selectedNoteId: state.selectedNoteId,
      editingNoteId: state.editingNoteId,
      query: state.query,
      contextPanelOpen: state.contextPanelOpen,
      registry: state.registry,
    })),
  );
  const actions = useNotesStore(
    useShallow((state) => ({
      load: state.load,
      setQuery: state.setQuery,
      toggleContextPanel: state.toggleContextPanel,
      setEditingNoteId: state.setEditingNoteId,
      toggleFavorite: state.toggleFavorite,
      createNote: state.createNote,
      updateNoteBody: state.updateNoteBody,
    })),
  );

  const [newNoteOpen, setNewNoteOpen] = useState(false);
  useEffect(() => {
    if (user?.id) void actions.load(user.id, props.spaceId, props.spaceName);
  }, [actions.load, props.spaceId, props.spaceName, user?.id]);

  const loading = store.phase === "loading" || store.phase === "idle";

  const selectedNote = store.notes.find((note) => note.id === store.selectedNoteId);
  const selectedConnector = selectedNote
    ? store.registry.forSource(selectedNote.source)
    : undefined;

  return (
    <div className={shellClass}>
      <NotesTopBar
        query={store.query}
        contextPanelOpen={store.contextPanelOpen}
        onQueryChange={actions.setQuery}
        onNewNote={() => setNewNoteOpen(true)}
        onToggleContextPanel={actions.toggleContextPanel}
      />

      <div className={store.contextPanelOpen ? bodyWithContextClass : bodyClass}>
        <NoteReadingPane
          note={selectedNote}
          loading={loading}
          editingNoteId={store.editingNoteId}
          onEditingNoteChange={actions.setEditingNoteId}
          onSaveBody={
            selectedConnector?.capabilities.update
              ? (noteId, body) => void actions.updateNoteBody(noteId, body)
              : undefined
          }
          onToggleFavorite={(noteId) => void actions.toggleFavorite(noteId)}
          onNewNote={() => setNewNoteOpen(true)}
        />

        {store.contextPanelOpen ? (
          <div className="min-h-0 max-[1100px]:hidden">
            <NoteContextPanel note={selectedNote} />
          </div>
        ) : null}
      </div>

      <NewNoteDialog
        open={newNoteOpen}
        onOpenChange={setNewNoteOpen}
        onCreate={async (input) => {
          await actions.createNote(input);
        }}
      />
    </div>
  );
}
