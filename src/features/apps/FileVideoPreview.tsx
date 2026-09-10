import { useContext } from "react";
import type { MistyFileVideoPreview } from "@misty/sdk";
import { FilePreviewMount, FilePreviewRenderersContext } from "./FilePdfPreview";
export default function FileVideoPreview(preview: MistyFileVideoPreview) {
  return (
    <FilePreviewMount
      render={useContext(FilePreviewRenderersContext).renderVideo}
      preview={preview}
    />
  );
}
