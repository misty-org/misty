import { SystemErrorNotice } from "@/features/support/systemErrors";
import { PhotoEditorView, type PhotoEditorProps } from "./PhotoEditorView";
export type { PhotoEditorProps } from "./PhotoEditorView";
export function PhotoEditor(props: PhotoEditorProps) {
  return <PhotoEditorView {...props} Error={SystemErrorNotice} />;
}
