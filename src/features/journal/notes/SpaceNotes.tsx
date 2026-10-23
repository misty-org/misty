import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { useMemo } from "react";
import { NewNoteDialog } from "./components/NewNoteDialog";
import { NotePreview } from "./components/NotePreview";
import { NoteReadingPane } from "./components/NoteReadingPane";
import { SpaceNotesView, type NotesViewRuntime, type SpaceNotesProps } from "./SpaceNotesView";
import { useNotesStore } from "./store/useNotesStore";
export type { SpaceNotesProps } from "./SpaceNotesView";
const emptyMembers: never[] = [];
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
    }),
    [user, referenceOnly, members, props.spaceId],
  );
  return <SpaceNotesView {...props} runtime={runtime} />;
}
