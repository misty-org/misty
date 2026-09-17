import { useContext } from "react";
import type { MistyFilePhotoEditor } from "@misty/sdk";
import type { PreviewErrorComponent } from "@/features/file-ui";
import { FilePreviewMount, FilePreviewRenderersContext } from "./FilePdfPreview";
export type PhotoEditorProps = MistyFilePhotoEditor;
export function PhotoEditorView({
  Error: _Error,
  ...preview
}: PhotoEditorProps & { Error: PreviewErrorComponent }) {
  return (
    <FilePreviewMount
      render={useContext(FilePreviewRenderersContext).renderPhoto}
      preview={preview}
    />
  );
}
