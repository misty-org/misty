import { useMemo } from "react";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceTabTitle } from "@/features/workspace";
import { useLocalPinnedIds } from "@/shared/hooks/useLocalPinnedIds";
import { useMobileSurfaceChrome, useSurfacePresentation } from "@/shared/mobile";
import { NewNoteDialog } from "./components/NewNoteDialog";
import { NotePreview } from "./components/NotePreview";
import { NoteReadingPane } from "./components/NoteReadingPane";
import { useNotesStore } from "./store";
import { SpaceNotesView, type NotesViewRuntime } from "./SpaceNotesView";
import type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
export type { SpaceNotesProps } from "./model/interfaces/SpaceNotes";
const emptyMembers: never[] = [];
function Integration(props: Parameters<NotesViewRuntime["renderIntegration"]>[0]) {
  useMobileSurfaceChrome(props.chrome);
  useWorkspaceTabTitle(props.workspaceTabId, props.title);
  return null;
}
export function SpaceNotes(props: SpaceNotesProps) {
  const { user } = useAuth();
  const presentation = useSurfacePresentation();
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const members = useSpacesStore((state) => state.membersBySpace[props.spaceId] ?? emptyMembers);
  const runtime = useMemo<NotesViewRuntime>(
    () => ({
      user,
      presentation,
      referenceOnly,
      members,
      useStore: useNotesStore,
      usePinnedIds: useLocalPinnedIds,
      ReadingPane: NoteReadingPane,
      Preview: NotePreview,
      NewNoteDialog,
      subscribeChanges(listener) {
        const receive = (event: Event) => {
          if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === props.spaceId)
            listener();
        };
        window.addEventListener("misty:space-note-event", receive);
        return () => window.removeEventListener("misty:space-note-event", receive);
      },
      renameNote: (noteId) => {
        window.dispatchEvent(new CustomEvent("misty:journal-rename-note", { detail: { noteId } }));
      },
      renderIntegration: (input) => <Integration {...input} />,
    }),
    [user, presentation, referenceOnly, members, props.spaceId],
  );
  return <SpaceNotesView {...props} runtime={runtime} />;
}
