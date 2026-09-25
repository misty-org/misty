import { lazy } from "react";
import { notesApi } from "@/api/notes/api";
import { useMemo } from "react";
import { useNoteCollaborationRoom } from "../hooks/useNoteCollaborationRoom";
import {
  NoteReadingPaneView,
  type NoteReadingRuntime,
  type NoteReadingPaneProps,
} from "./NoteReadingPaneView";
export type {
  NoteReadingPaneProps,
  NoteContentDraft,
  NoteConflictNoticeProps,
} from "./NoteReadingPaneView";
const runtime: NoteReadingRuntime = {
  useCollaborationRoom(spaceId, noteId) {
    const room = useNoteCollaborationRoom(spaceId, noteId);
    const session = useMemo(
      () => (room.session ? { ...room.session, role: room.session.ticket.role } : null),
      [room.session],
    );
    return { ...room, session };
  },
  backlinks: notesApi.backlinks,
  subscribeRename(noteId, focus) {
    const receive = (event: Event) => {
      if ((event as CustomEvent<{ noteId?: string }>).detail?.noteId === noteId) focus();
    };
    window.addEventListener("misty:journal-rename-note", receive);
    return () => window.removeEventListener("misty:journal-rename-note", receive);
  },
  Editor: lazy(() => import("./NoteBlockEditor")),
};
export function NoteReadingPane(props: NoteReadingPaneProps) {
  return <NoteReadingPaneView {...props} runtime={runtime} />;
}
