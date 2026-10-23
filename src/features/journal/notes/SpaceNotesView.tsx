import { JournalDeleteDialog } from "@/features/journal";
import { confirmAction } from "@/shared/lib/confirmAction";
import { JournalCollection } from "./components/JournalCollection";
import { useWorkspaceViewTitle } from "@/features/workspace";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { NotePreviewProps } from "./components/NotePreviewView";
import type { NoteReadingPaneProps } from "./components/NoteReadingPaneView";
import type { NewNoteDialogProps } from "./components/NewNoteDialogView";
import type { UnifiedNote } from "./model/types";
import { selectVisibleNotes } from "./noteFilters";
import type { createNotesStore } from "./store/createNotesStore";
export interface SpaceNotesProps {
  spaceId: string;
  spaceName: string;
  workspaceTabId?: string;
}
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
  subscribeChanges(listener: () => void): () => void;
  renameNote(noteId: string): void;
  ReadingPane: ComponentType<NoteReadingPaneProps>;
  Preview: ComponentType<NotePreviewProps>;
  NewNoteDialog: ComponentType<NewNoteDialogProps>;
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
      error: state.error,
      selectedNoteId: state.selectedNoteId,
      accountId: state.accountId,
      query: state.query,
    })),
  );
  const actions = useNotesStore(
    useShallow((state) => ({
      load: state.load,
      setQuery: state.setQuery,
      selectNote: state.selectNote,
      createNote: state.createNote,
      deleteNote: state.deleteNote,
      refresh: state.refresh,
    })),
  );
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [deleteManyError, setDeleteManyError] = useState("");
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
      void actions.load(user.id, props.spaceId, props.spaceName);
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
  const visibleNotes = useMemo(
    () => selectVisibleNotes(store.notes, store.query, Date.now(), props.spaceId),
    [store.notes, store.query, props.spaceId],
  );
  const selectedNote = store.notes.find((note) => note.id === store.selectedNoteId);
  useWorkspaceViewTitle(props.workspaceTabId, selectedNote?.title?.trim() || "Notes");
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
  const deleteManyNotes = async (ids: string[]) => {
    if (!ids.length || referenceOnly) return;
    const count = ids.length;
    if (
      !(await confirmAction(
        `Permanently delete ${count} selected ${count === 1 ? "note" : "notes"}?`,
      ))
    )
      return;
    setDeleteManyError("");
    const removed: string[] = [];
    try {
      for (const id of ids) {
        await actions.deleteNote(id);
        removed.push(id);
      }
      if (removed.includes(selectedNote?.id ?? "")) {
        const next = new URLSearchParams(searchParams);
        next.delete("note");
        next.set("view", "list");
        setSearchParams(next, { replace: true });
      }
    } catch {
      setDeleteManyError("Some selected notes couldn't be deleted. Try again.");
    }
  };
  return (
    <div className={shellClass}>
      {view === "list" ? (
        <JournalCollection
          spaceId={props.spaceId}
          notes={visibleNotes}
          loading={loading}
          error={store.phase === "error" || Boolean(store.error)}
          onRetry={() => void actions.refresh()}
          query={store.query}
          onQueryChange={actions.setQuery}
          readOnly={referenceOnly}
          onCreate={() => setNewNoteOpen(true)}
          onOpen={openNote}
          onRename={(note) => openNote(note, true)}
          onDelete={(note) => setDeleteNoteId(note.id)}
          onDeleteMany={(ids) => void deleteManyNotes(ids)}
          bulkError={deleteManyError}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <NoteReadingPane
            note={selectedNote}
            hasNotes={store.notes.length > 0}
            accountId={store.accountId}
            loading={loading}
            onBack={() => rememberNoteView("list", selectedNote)}
            referenceOnly={referenceOnly}
            renameRequested={
              searchParams.get("rename") === "1" && selectedNote?.sourceId === noteTarget
            }
            onRenameHandled={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("rename");
              setSearchParams(next, { replace: true });
            }}
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
