import type { NotesPanelSidebarProps } from "@/models/interfaces/features/notes/SpaceNotes";
export type { NotesPanelSidebarProps } from "@/models/interfaces/features/notes/SpaceNotes";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { SpaceSidebarSection } from "@/features/spaces/components/SpaceSidebarSection";
import { SpaceSidebarPageSection } from "@/features/spaces/components/SpaceSidebarPageSection";
import { useNotesStore } from "@/stores/notes";
import { selectVisibleNotes } from "@/features/notes/noteFilters";
import { NoteListPanel } from "./NoteListPanel";
import { NewNoteDialog } from "./NewNoteDialog";

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
    />
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
