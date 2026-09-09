import { SystemErrorActivity } from "@/features/activity";
import { PhotoEditorView, type PhotoEditorProps } from "./PhotoEditorView";
export type { PhotoEditorProps } from "./PhotoEditorView";
export function PhotoEditor(props: PhotoEditorProps) {
  return <PhotoEditorView {...props} Error={SystemErrorActivity} />;
}
