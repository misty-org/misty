import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceTabTitle } from "@/features/workspace";
import { useLocalPinnedIds } from "@/shared/hooks/useLocalPinnedIds";
import { useMemo } from "react";
import { NewNoteDialog } from "./components/NewNoteDialog";
import { NotePreview } from "./components/NotePreview";
import { NoteReadingPane } from "./components/NoteReadingPane";
import type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
import { SpaceNotesView, type NotesViewRuntime } from "./SpaceNotesView";
import { useNotesStore } from "./store";
export type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
const emptyMembers: never[] = [];
function Integration(props: Parameters<NotesViewRuntime["renderIntegration"]>[0]) {
  useWorkspaceTabTitle(props.workspaceTabId, props.title);
  return null;
}
export function SpaceNotes(props: SpaceNotesProps) {
  const { user } = useAuth();
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const members = useSpacesStore((state) => state.membersBySpace[props.spaceId] ?? emptyMembers);
  const runtime = useMemo<NotesViewRuntime>(
    () => ({
      user,
      referenceOnly,
      members,
      useStore: useNotesStore,
      usePinnedIds: useLocalPinnedIds,
      ReadingPane: NoteReadingPane,
      Preview: NotePreview,
      NewNoteDialog,
      subscribeChanges(listener) {
        const receive = (event: Event) => {
          if (
            (
              event as CustomEvent<{
                space_id?: string;
              }>
            ).detail?.space_id === props.spaceId
          )
            listener();
        };
        window.addEventListener("misty:space-note-event", receive);
        return () => window.removeEventListener("misty:space-note-event", receive);
      },
      renameNote: (noteId) => {
        window.dispatchEvent(
          new CustomEvent("misty:journal-rename-note", {
            detail: {
              noteId,
            },
          }),
        );
      },
      renderIntegration: (input) => <Integration {...input} />,
    }),
    [user, referenceOnly, members, props.spaceId],
  );
  return <SpaceNotesView {...props} runtime={runtime} />;
}
