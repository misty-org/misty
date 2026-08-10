import { JournalDeleteDialog } from "@/features/journal";
import type { useLocalPinnedIds } from "@/shared/hooks/useLocalPinnedIds";
import { JournalCollection } from "./components/JournalCollection";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { NotePreviewProps } from "./components/NotePreviewView";
import type { NoteReadingPaneProps } from "./components/NoteReadingPaneView";
import type { NewNoteDialogProps } from "./model/interfaces/components/NotesIntegrationsDialog";
import type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
import type { UnifiedNote } from "./model/types/types";
import { selectVisibleNotes } from "./noteFilters";
import type { createNotesStore } from "./store/createNotesStore";
export type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
const shellClass =
  "relative flex h-full min-h-0 flex-col bg-charcoal-bg text-cream overflow-hidden";
export interface NotesViewRuntime {
  user?: {
    id: string;
    name?: string;
    email?: string;
  } | null;
  members: readonly {
    user_id: string;
    name: string;
  }[];
  referenceOnly: boolean;
  useStore: ReturnType<typeof createNotesStore>["useStore"];
  usePinnedIds: typeof useLocalPinnedIds;
  subscribeChanges(listener: () => void): () => void;
  renameNote(noteId: string): void;
  ReadingPane: ComponentType<NoteReadingPaneProps>;
  Preview: ComponentType<NotePreviewProps>;
  NewNoteDialog: ComponentType<NewNoteDialogProps>;
  renderIntegration(input: { title: string; workspaceTabId?: string }): ReactNode;
}
export function SpaceNotesView(
  props: SpaceNotesProps & {
    runtime: NotesViewRuntime;
  },
) {
  const {
    user,
    referenceOnly,
    useStore: useNotesStore,
    subscribeChanges,
    ReadingPane: NoteReadingPane,
    NewNoteDialog,
  } = props.runtime;
  const [searchParams, setSearchParams] = useSearchParams();
  const noteTarget = searchParams.get("note");
  const requestedView = searchParams.get("view");
  const view =
    requestedView === "list" ? "list" : requestedView === "doc" || noteTarget ? "doc" : "list";
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
    })),
  );
  const actions = useNotesStore(
    useShallow((state) => ({
      load: state.load,
      setQuery: state.setQuery,
      setEditingNoteId: state.setEditingNoteId,
      selectNote: state.selectNote,
      createNote: state.createNote,
      archiveNote: state.archiveNote,
      deleteNote: state.deleteNote,
      refresh: state.refresh,
      syncAll: state.syncAll,
      updateNoteBody: state.updateNoteBody,
      updateNoteContent: state.updateNoteContent,
    })),
  );
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
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
    setSearchParams(next, {
      replace: true,
    });
    if (!referenceOnly) setNewNoteOpen(true);
  }, [referenceOnly, searchParams, setSearchParams]);
  useEffect(() => {
    if (user?.id) {
      void actions.load(user.id, props.spaceId, props.spaceName).then(() => actions.syncAll());
    }
  }, [actions, props.spaceId, props.spaceName, user?.id]);
  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer != null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void actions.refresh();
      }, 100);
    };
    const remove = subscribeChanges(scheduleRefresh);
    return () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      remove();
    };
  }, [actions, props.spaceId, subscribeChanges]);
  const loading = store.phase === "loading" || store.phase === "idle";
  useEffect(() => {
    if (!store.selectedNoteId && store.notes.length > 0) {
      actions.selectNote(store.notes[0].id);
    }
  }, [actions, store.notes, store.selectedNoteId]);
  useEffect(() => {
    if (!noteTarget || !store.notes.length) return;
    const resolved = store.notes.find(
      (note) => note.id === noteTarget || note.sourceId === noteTarget,
    );
    if (!resolved) return;
    actions.selectNote(resolved.id);
  }, [actions, noteTarget, store.notes]);
  const orderedNotes = useMemo(
    () => selectVisibleNotes(store.notes, "", Date.now(), props.spaceId),
    [store.notes, props.spaceId],
  );
  const visibleNotes = useMemo(
    () => selectVisibleNotes(store.notes, store.query, Date.now(), props.spaceId),
    [store.notes, store.query, props.spaceId],
  );
  const notePinsKey = `misty:note-pins:${user?.id ?? "anonymous"}:${props.spaceId}`;
  const availableNoteIds = useMemo(() => orderedNotes.map((note) => note.id), [orderedNotes]);
  const { pinnedIdSet, togglePinned } = props.runtime.usePinnedIds(
    notePinsKey,
    availableNoteIds,
    loading,
  );
  const selectedNote = store.notes.find((note) => note.id === store.selectedNoteId);
  const selectedConnector = selectedNote
    ? store.registry.forSource(selectedNote.source)
    : undefined;
  const rememberNoteView = useCallback(
    (nextView: "doc" | "list", note?: UnifiedNote) => {
      const next = new URLSearchParams(searchParams);
      next.set("view", nextView);
      if (note) next.set("note", note.sourceId || note.id);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );
  const openNote = (note: UnifiedNote, rename = false) => {
    actions.selectNote(note.id);
    rememberNoteView("doc", note);
    if (!rename) return;
    window.setTimeout(() => props.runtime.renameNote(note.sourceId), 0);
  };
  return (
    <div className={shellClass}>
      {props.runtime.renderIntegration({
        title: selectedNote?.title?.trim() || "Notes",
        workspaceTabId: props.workspaceTabId,
      })}
      {view === "list" ? (
        <JournalCollection
          spaceId={props.spaceId}
          notes={visibleNotes}
          loading={loading}
          error={store.phase === "error" || Object.keys(store.connectorErrors).length > 0}
          onRetry={() => void actions.refresh()}
          query={store.query}
          onQueryChange={actions.setQuery}
          pinnedIds={pinnedIdSet}
          readOnly={referenceOnly}
          onCreate={() => setNewNoteOpen(true)}
          onOpen={openNote}
          onRename={(note) => openNote(note, true)}
          onTogglePin={togglePinned}
          onDelete={(note) => setDeleteNoteId(note.id)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <NoteReadingPane
            note={selectedNote}
            hasNotes={store.notes.length > 0}
            accountId={store.accountId}
            loading={loading}
            onBack={() => rememberNoteView("list", selectedNote)}
            editingNoteId={store.editingNoteId}
            referenceOnly={referenceOnly}
            renameRequested={
              searchParams.get("rename") === "1" && selectedNote?.sourceId === noteTarget
            }
            onRenameHandled={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("rename");
              setSearchParams(next, { replace: true });
            }}
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
            linkableNotes={store.notes}
            onSelectNote={(noteId) => {
              const note = store.notes.find(
                (candidate) => candidate.id === noteId || candidate.sourceId === noteId,
              );
              if (!note) return;
              actions.selectNote(note.id);
              rememberNoteView("doc", note);
            }}
          />
        </div>
      )}

      <NewNoteDialog
        open={newNoteOpen}
        onOpenChange={setNewNoteOpen}
        onCreate={async (input) => {
          const note = await actions.createNote(input);
          if (note) {
            actions.selectNote(note.id);
            rememberNoteView("doc", note);
          }
        }}
      />
      <JournalDeleteDialog
        kind="note"
        title={store.notes.find((note) => note.id === deleteNoteId)?.title ?? ""}
        open={Boolean(deleteNoteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteNoteId(null);
        }}
        onConfirm={async () => {
          if (!deleteNoteId) return;
          const deletedSelectedNote = deleteNoteId === selectedNote?.id;
          await actions.deleteNote(deleteNoteId);
          if (deletedSelectedNote) {
            const next = new URLSearchParams(searchParams);
            next.delete("note");
            next.set("view", "list");
            setSearchParams(next, {
              replace: true,
            });
          }
        }}
      />
    </div>
  );
}
