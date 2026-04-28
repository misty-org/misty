import type { SpaceNotesProps } from "@/models/interfaces/features/notes/SpaceNotes";
export type { SpaceNotesProps } from "@/models/interfaces/features/notes/SpaceNotes";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { useNotesStore } from "@/stores/notes";
import { NotesTopBar } from "./components/NotesTopBar";
import { NoteReadingPane } from "./components/NoteReadingPane";
import { NewNoteDialog } from "./components/NewNoteDialog";
import { JournalAttribution } from "@/features/journal/components/JournalAttribution";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

const shellClass =
  "relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg text-cream";

const bodyClass = "grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden";

export function SpaceNotes(props: SpaceNotesProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const store = useNotesStore(
    useShallow((state) => ({
      phase: state.phase,
      notes: state.notes,
      connectorErrors: state.connectorErrors,
      selectedNoteId: state.selectedNoteId,
      editingNoteId: state.editingNoteId,
      accountId: state.accountId,
      query: state.query,
      registry: state.registry,
    })),
  );
  const actions = useNotesStore(
    useShallow((state) => ({
      load: state.load,
      setQuery: state.setQuery,
      setEditingNoteId: state.setEditingNoteId,
      toggleFavorite: state.toggleFavorite,
      createNote: state.createNote,
      deleteNote: state.deleteNote,
      refresh: state.refresh,
      updateNoteBody: state.updateNoteBody,
      updateNoteContent: state.updateNoteContent,
    })),
  );
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);

  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const createQueryConsumedRef = useRef(false);
  useEffect(() => {
    if (searchParams.get("create") !== "note") {
      createQueryConsumedRef.current = false;
      return;
    }
    if (createQueryConsumedRef.current) return;
    createQueryConsumedRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
    if (!referenceOnly) setNewNoteOpen(true);
  }, [referenceOnly, searchParams, setSearchParams]);
  useEffect(() => {
    if (user?.id) void actions.load(user.id, props.spaceId, props.spaceName);
  }, [actions.load, props.spaceId, props.spaceName, user?.id]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id !== props.spaceId || refreshTimer != null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void actions.refresh();
      }, 100);
    };
    window.addEventListener("misty:space-note-event", scheduleRefresh);
    return () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      window.removeEventListener("misty:space-note-event", scheduleRefresh);
    };
  }, [actions.refresh, props.spaceId]);

  const loading = store.phase === "loading" || store.phase === "idle";

  const selectedNote = store.notes.find((note) => note.id === store.selectedNoteId);
  const selectedConnector = selectedNote
    ? store.registry.forSource(selectedNote.source)
    : undefined;

  return (
    <div className={shellClass}>
      <NotesTopBar
        query={store.query}
        noteTitle={selectedNote?.title}
        readOnly={referenceOnly}
        onQueryChange={actions.setQuery}
        onNewNote={() => {
          if (!referenceOnly) setNewNoteOpen(true);
        }}
      />

      <div className={bodyClass}>
        <NoteReadingPane
          note={selectedNote}
          hasNotes={store.notes.length > 0}
          accountId={store.accountId}
          loading={loading}
          editingNoteId={store.editingNoteId}
          referenceOnly={referenceOnly}
          onEditingNoteChange={actions.setEditingNoteId}
          onSaveBody={
            selectedConnector?.capabilities.update
              ? (noteId, body) => void actions.updateNoteBody(noteId, body)
              : undefined
          }
          onSaveContent={
            selectedConnector?.capabilities.update
              ? (noteId, content) => void actions.updateNoteContent(noteId, content)
              : undefined
          }
          onToggleFavorite={
            referenceOnly ? undefined : (noteId) => void actions.toggleFavorite(noteId)
          }
          onDelete={
            !referenceOnly && selectedConnector?.capabilities.delete && selectedNote?.canDelete
              ? actions.deleteNote
              : undefined
          }
          onNewNote={() => {
            if (!referenceOnly) setNewNoteOpen(true);
          }}
        />
      </div>

      <NewNoteDialog
        open={newNoteOpen}
        onOpenChange={setNewNoteOpen}
        onCreate={async (input) => {
          await actions.createNote(input);
        }}
      />
      <JournalAttribution
        technology="BlockNote"
        href="https://www.blocknotejs.org/"
        className="absolute bottom-3 right-3 z-20 shadow-sm "
      />
    </div>
  );
}
