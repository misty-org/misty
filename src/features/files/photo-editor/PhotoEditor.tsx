import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { PhotoEditorView, type PhotoEditorProps } from "./PhotoEditorView";
export function PhotoEditor(props: PhotoEditorProps) {
  return <PhotoEditorView {...props} Error={SystemErrorNotice} />;
}
