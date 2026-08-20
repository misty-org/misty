import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { NewNoteDialog } from "./components/NewNoteDialog";
import { NoteReadingPane } from "./components/NoteReadingPane";
import type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
import { useNotesStore } from "./store";
import { NOTION_CONNECTOR_ID } from "./mockData";
export type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";

const shellClass = "relative h-full min-h-0 bg-charcoal-bg text-cream";

const bodyClass = "grid h-full min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden";

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
      syncing: state.syncing,
      connectorRevision: state.connectorRevision,
      publishingNoteId: state.publishingNoteId,
      publishError: state.publishError,
    })),
  );
  const actions = useNotesStore(
    useShallow((state) => ({
      load: state.load,
      setEditingNoteId: state.setEditingNoteId,
      selectNote: state.selectNote,
      createNote: state.createNote,
      deleteNote: state.deleteNote,
      refresh: state.refresh,
      syncAll: state.syncAll,
      updateNoteBody: state.updateNoteBody,
      updateNoteContent: state.updateNoteContent,
      publishNote: state.publishNote,
      openInSource: state.openInSource,
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
    if (user?.id) {
      void actions.load(user.id, props.spaceId, props.spaceName).then(() => actions.syncAll());
    }
  }, [actions, props.spaceId, props.spaceName, user?.id]);

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
  }, [actions, props.spaceId]);

  const loading = store.phase === "loading" || store.phase === "idle";

  const selectedNote = store.notes.find((note) => note.id === store.selectedNoteId);
  const selectedConnector = selectedNote
    ? store.registry.forSource(selectedNote.source)
    : undefined;
  const notionConnector = store.registry.get(NOTION_CONNECTOR_ID);
  const canPublishToNotion =
    notionConnector?.status() === "connected" &&
    Boolean(notionConnector.selectedSourceIds?.().length);

  return (
    <div className={shellClass}>
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
          onDelete={
            !referenceOnly && selectedConnector?.capabilities.delete && selectedNote?.canDelete
              ? actions.deleteNote
              : undefined
          }
          onNewNote={() => {
            if (!referenceOnly) setNewNoteOpen(true);
          }}
          onOpenInSource={selectedNote?.source === "notion" ? actions.openInSource : undefined}
          onPublish={canPublishToNotion ? (noteId) => void actions.publishNote(noteId) : undefined}
          publishing={store.publishingNoteId === selectedNote?.id}
          publishError={store.publishError || store.connectorErrors[NOTION_CONNECTOR_ID]}
          linkableNotes={store.notes}
          onSelectNote={actions.selectNote}
        />
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
