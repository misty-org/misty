import { lazy } from "react";
import { reportSystemError } from "@/features/support/systemErrors";
import { NotePreviewView, type NotePreviewProps } from "./NotePreviewView";
const Editor = lazy(() => import("./NoteBlockEditor"));
export function NotePreview(props: NotePreviewProps) {
  return (
    <NotePreviewView
      {...props}
      runtime={{
        Editor,
        copy: (text) => navigator.clipboard.writeText(text),
        report: (error) =>
          reportSystemError({
            error,
            scope: `notes:${props.note.spaceId ?? "unknown"}:${props.note.sourceId}:copy`,
            title: "Note could not be copied",
          }),
      }}
    />
  );
}
