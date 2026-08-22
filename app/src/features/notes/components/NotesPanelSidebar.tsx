import { SpaceSidebarPageSection, SpaceSidebarSection } from "@/features/spaces";
import { Button, Input } from "@/shared/ui";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { NotesPanelSidebarProps } from "../model/interfaces/SpaceNotes";
import { selectVisibleNotes } from "../noteFilters";
import { useNotesStore } from "../store";
import { NewNoteDialog } from "./NewNoteDialog";
import { NoteListPanel } from "./NoteListPanel";
export type { NotesPanelSidebarProps } from "../model/interfaces/SpaceNotes";

export function NotesPanelSidebar(
  props: NotesPanelSidebarProps & { section?: { active: boolean; to: string } },
) {
  const navigate = useNavigate();
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
      archiveNote: state.archiveNote,
      deleteNote: state.deleteNote,
    })),
  );

  const loading = store.phase === "loading" || store.phase === "idle";
  const visibleNotes = useMemo(
    () => selectVisibleNotes(store.notes, store.query, Date.now(), props.spaceId),
    [store.notes, store.query, props.spaceId],
  );

  // Picking a note from the sidebar should show it, even when a Drawing (a
  // sibling section sharing this sidebar) is the current route.
  const selectNote = (noteId: string) => {
    actions.selectNote(noteId);
    if (props.section && !props.section.active) navigate(props.section.to);
  };

  const action = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-6 shrink-0 opacity-0 shadow-none group-hover/sidebar-page:opacity-100 group-hover/sidebar-header:opacity-100 focus-visible:opacity-100"
      title="New note"
      aria-label="New note"
      onClick={() => setNewNoteOpen(true)}
    >
      <Plus size={13} />
    </Button>
  );
  const content = (
    <div className="grid min-h-0 gap-2">
      <label className="relative block px-0.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-cream-muted" />
        <Input
          value={store.query}
          onChange={(event) => actions.setQuery(event.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          className="h-8 rounded-lg border-charcoal-border bg-charcoal-card pl-8 text-xs"
        />
      </label>
      <NoteListPanel
        notes={visibleNotes}
        query={store.query}
        loading={loading}
        spaceName={props.spaceName}
        showHeader={false}
        selectedNoteId={store.selectedNoteId}
        connectorErrors={store.connectorErrors}
        onSelectNote={selectNote}
        onNewNote={() => setNewNoteOpen(true)}
        onClearQuery={() => actions.setQuery("")}
        onRenameNote={(note) => {
          selectNote(note.id);
          window.setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("misty:journal-rename-note", { detail: { noteId: note.sourceId } }),
              ),
            0,
          );
        }}
        onArchiveNote={(note) => void actions.archiveNote(note.id)}
        onDeleteNote={(note) => {
          if (window.confirm(`Delete “${note.title}”? This cannot be undone.`))
            void actions.deleteNote(note.id);
        }}
      />
    </div>
  );

  return (
    <>
      {props.section ? (
        <SpaceSidebarPageSection
          active={props.section.active}
          label="Notes"
          to={props.section.to}
          count={visibleNotes.length}
          action={action}
        >
          {content}
        </SpaceSidebarPageSection>
      ) : (
        <SpaceSidebarSection title="Notes" count={visibleNotes.length} action={action}>
          {content}
        </SpaceSidebarSection>
      )}
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
