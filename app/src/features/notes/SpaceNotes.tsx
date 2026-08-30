import { useAuth } from "@/features/auth";
import { JournalDeleteDialog } from "@/features/journal";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceTabTitle } from "@/features/workspace";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import { personInitials } from "@/shared/lib/personInitials";
import { useLocalPinnedIds } from "@/shared/hooks/useLocalPinnedIds";
import {
  Avatar,
  AvatarFallback,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Skeleton,
  cn,
} from "@/shared/ui";
import { MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { NewNoteDialog } from "./components/NewNoteDialog";
import { NotePreview } from "./components/NotePreview";
import { NotePreviewHeader } from "./components/NotePreviewHeader";
import { NoteReadingPane } from "./components/NoteReadingPane";
import type { UnifiedNote } from "./model/types/types";
import type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
import { selectVisibleNotes } from "./noteFilters";
import { useNotesStore } from "./store";
export type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";

const shellClass =
  "relative flex h-full min-h-0 flex-col bg-charcoal-bg text-cream overflow-hidden";
const emptyMembers: never[] = [];

export function SpaceNotes(props: SpaceNotesProps) {
  const { user } = useAuth();
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
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const members = useSpacesStore((state) => state.membersBySpace[props.spaceId] ?? emptyMembers);

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
  const { pinnedIdSet, togglePinned } = useLocalPinnedIds(notePinsKey, availableNoteIds, loading);
  const pinnedNotes = orderedNotes.filter((note) => pinnedIdSet.has(note.id));
  const recentNotes = orderedNotes.filter((note) => !pinnedIdSet.has(note.id));

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

  const creatorNameForNote = (note: UnifiedNote) => {
    const creator = members.find((member) => member.user_id === note.creatorUserId);
    if (creator?.name) return creator.name;
    if (note.creatorUserId === user?.id) return user?.name || user?.email || "You";
    return "Unknown creator";
  };

  const openNote = (note: UnifiedNote, rename = false) => {
    actions.selectNote(note.id);
    rememberNoteView("doc", note);
    if (!rename) return;
    window.setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent("misty:journal-rename-note", {
            detail: { noteId: note.sourceId },
          }),
        ),
      0,
    );
  };

  useWorkspaceTabTitle(props.workspaceTabId, selectedNote?.title?.trim() || "Notes");

  return (
    <div className={shellClass}>
      {view === "list" ? (
        <div className="grid min-h-0 flex-1 gap-5 p-5 md:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
          {loading ? (
            <>
              <Skeleton className="min-h-72 rounded-2xl" />
              <Skeleton className="min-h-72 rounded-2xl" />
            </>
          ) : (
            <>
              <section className="flex min-h-0 flex-col">
                <div className="mb-2 flex h-8 shrink-0 items-center gap-2">
                  <h1 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">
                    My Notes
                  </h1>
                  {!referenceOnly ? (
                    <Button
                      className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                      type="button"
                      onClick={() => setNewNoteOpen(true)}
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      New
                    </Button>
                  ) : null}
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card">
                  <div className="shrink-0 border-b border-charcoal-border p-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-cream-muted" />
                      <Input
                        className="h-8 bg-charcoal-bg pl-8 text-xs"
                        aria-label="Search notes"
                        placeholder="Search notes"
                        value={store.query}
                        onChange={(event) => actions.setQuery(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto">
                    {visibleNotes.length === 0 ? (
                      <EmptyState
                        className="h-full min-h-48"
                        title={store.query ? "No matching notes" : "Capture ideas together"}
                        description={
                          store.query
                            ? `Nothing matches “${store.query}”.`
                            : "Create a shared note for writing, planning, and decisions."
                        }
                        action={
                          store.query ? (
                            <Button variant="secondary" onClick={() => actions.setQuery("")}>
                              Clear search
                            </Button>
                          ) : !referenceOnly ? (
                            <Button onClick={() => setNewNoteOpen(true)}>Create note</Button>
                          ) : undefined
                        }
                      />
                    ) : store.query.trim() ? (
                      <NoteRows
                        notes={visibleNotes}
                        selectedId={selectedNote?.id}
                        pinnedIds={pinnedIdSet}
                        onSelect={(note) => {
                          actions.selectNote(note.id);
                          rememberNoteView("list", note);
                        }}
                        onRename={(note) => openNote(note, true)}
                        onTogglePin={togglePinned}
                        onDelete={(note) => setDeleteNoteId(note.id)}
                      />
                    ) : (
                      <div className="pb-2">
                        <NoteSection
                          title="Pinned"
                          notes={pinnedNotes}
                          emptyLabel="Pin a note from its menu for quick access."
                          selectedId={selectedNote?.id}
                          pinnedIds={pinnedIdSet}
                          onSelect={(note) => {
                            actions.selectNote(note.id);
                            rememberNoteView("list", note);
                          }}
                          onRename={(note) => openNote(note, true)}
                          onTogglePin={togglePinned}
                          onDelete={(note) => setDeleteNoteId(note.id)}
                        />
                        <NoteSection
                          title="Recently edited"
                          notes={recentNotes}
                          emptyLabel="Your pinned notes are shown above."
                          selectedId={selectedNote?.id}
                          pinnedIds={pinnedIdSet}
                          onSelect={(note) => {
                            actions.selectNote(note.id);
                            rememberNoteView("list", note);
                          }}
                          onRename={(note) => openNote(note, true)}
                          onTogglePin={togglePinned}
                          onDelete={(note) => setDeleteNoteId(note.id)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="flex min-h-0 flex-col">
                {selectedNote ? (
                  <NotePreviewHeader note={selectedNote} onOpen={() => openNote(selectedNote)} />
                ) : (
                  <div className="mb-2 flex h-8 shrink-0 items-center">
                    <h2 className="m-0 text-sm font-semibold text-cream-bright">Note preview</h2>
                  </div>
                )}
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card">
                  {selectedNote ? (
                    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
                      <NotePreview
                        key={selectedNote.id}
                        note={selectedNote}
                        accountId={store.accountId}
                        linkableNotes={store.notes}
                      />
                      <NoteMetadata
                        note={selectedNote}
                        creatorName={creatorNameForNote(selectedNote)}
                      />
                    </div>
                  ) : (
                    <EmptyState
                      className="h-full"
                      title="No note selected"
                      description="Choose a note from the list to preview it."
                    />
                  )}
                </div>
              </section>
            </>
          )}
        </div>
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
            setSearchParams(next, { replace: true });
          }
        }}
      />
    </div>
  );
}

type NoteRowsProps = {
  notes: UnifiedNote[];
  selectedId?: string;
  pinnedIds: Set<string>;
  onSelect: (note: UnifiedNote) => void;
  onRename: (note: UnifiedNote) => void;
  onTogglePin: (noteId: string) => void;
  onDelete: (note: UnifiedNote) => void;
};

function NoteSection(props: NoteRowsProps & { title: string; emptyLabel: string }) {
  return (
    <section aria-label={props.title}>
      <h2 className="m-0 px-3.5 pb-1.5 pt-3 text-xs font-semibold text-cream-muted">
        {props.title}
      </h2>
      {props.notes.length ? (
        <NoteRows {...props} />
      ) : (
        <p className="px-3.5 py-2 text-[11px] leading-4 text-cream-muted/75">{props.emptyLabel}</p>
      )}
    </section>
  );
}

function NoteRows(props: NoteRowsProps) {
  return props.notes.map((note) => {
    const isSelected = note.id === props.selectedId;
    const isPinned = props.pinnedIds.has(note.id);
    const title = note.title || "Untitled note";
    const canRename = note.role !== "viewer";
    return (
      <ContextMenu key={note.id}>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group/note flex h-10 items-center transition-colors",
              isSelected
                ? "bg-charcoal-hover hover:bg-charcoal-hover"
                : "bg-transparent hover:bg-charcoal-border/65",
            )}
          >
            <button
              type="button"
              aria-current={isSelected ? "true" : undefined}
              className="flex min-w-0 flex-1 self-stretch items-center gap-2 border-0 bg-transparent px-3.5 text-left outline-none"
              onClick={() => props.onSelect(note)}
            >
              <h3 className="m-0 min-w-0 flex-1 truncate text-[13px] font-medium text-cream-bright">
                {title}
              </h3>
              {isPinned ? (
                <Pin className="size-3 shrink-0 text-cream-muted" aria-hidden="true" />
              ) : null}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="mr-2 size-7 shrink-0 text-cream-muted opacity-0 hover:text-cream-bright group-hover/note:opacity-100 aria-expanded:opacity-100"
                  aria-label={`More actions for ${title}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={() => props.onTogglePin(note.id)}>
                  {isPinned ? <PinOff /> : <Pin />}
                  {isPinned ? "Unpin" : "Pin"}
                </DropdownMenuItem>
                {canRename || note.canDelete ? <DropdownMenuSeparator /> : null}
                {canRename ? (
                  <DropdownMenuItem onSelect={() => props.onRename(note)}>
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                ) : null}
                {note.canDelete ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(note)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onSelect={() => props.onTogglePin(note.id)}>
            {isPinned ? <PinOff /> : <Pin />}
            {isPinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
          {canRename || note.canDelete ? <ContextMenuSeparator /> : null}
          {canRename ? (
            <ContextMenuItem onSelect={() => props.onRename(note)}>
              <Pencil />
              Rename
            </ContextMenuItem>
          ) : null}
          {note.canDelete ? (
            <ContextMenuItem className="text-red-300" onSelect={() => props.onDelete(note)}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  });
}

function NoteMetadata(props: { note: UnifiedNote; creatorName: string }) {
  return (
    <section
      className="shrink-0 border-t border-charcoal-border px-5 py-3.5"
      aria-label="Note details"
    >
      <dl className="m-0 grid grid-cols-2 gap-x-8 gap-y-3 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[11px] font-medium text-cream-muted">Created by</dt>
          <dd className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-cream-bright">
            <Avatar className="size-5 shrink-0">
              <AvatarFallback
                className={cn(
                  "text-[8px] font-semibold",
                  avatarColorClass(props.note.creatorUserId ?? props.note.id),
                  avatarInkClass,
                )}
              >
                {personInitials(props.creatorName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{props.creatorName}</span>
          </dd>
        </div>
        <MetadataField label="Last edited" value={formatNoteDate(props.note.updatedAt)} />
        <MetadataField label="Created" value={formatNoteDate(props.note.createdAt)} />
        <MetadataField label="Access" value={noteRoleLabel(props.note.role)} />
      </dl>
    </section>
  );
}

function MetadataField(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-cream-muted">{props.label}</dt>
      <dd className="m-0 mt-1.5 truncate text-xs text-cream-bright" title={props.value}>
        {props.value}
      </dd>
    </div>
  );
}

function formatNoteDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function noteRoleLabel(role: UnifiedNote["role"]): string {
  if (role === "creator") return "Owner";
  if (role === "editor") return "Can edit";
  if (role === "viewer") return "View only";
  return "Shared";
}
