import type { PreviewErrorComponent } from "../preview/previewTypes";
import { IconButton, Skeleton, TopBar } from "@misty/ui";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PhotoEditorProps } from "./editorTypes";
import { decodedPhoto, openPhoto, type PhotoSource } from "./imageRender";
import { EditorFrame, EditorTitle } from "./PhotoEditorChrome";
import { PhotoEditorSession } from "./PhotoEditorSession";

export type { PhotoEditorProps } from "./editorTypes";

/**
 * Misty's photo editor over the window, laid out as the video editor (OpenCut's editor, without
 * the timeline). It opens the image, showing the editor's shape until it is decoded.
 */
export function PhotoEditorView(props: PhotoEditorProps & { Error: PreviewErrorComponent }) {
  const [source, setSource] = useState<{ url: string; photo: PhotoSource } | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!props.url) return;
    let live = true;
    setLoadError("");
    openPhoto(props.url)
      .then((photo) => live && setSource({ url: props.url, photo }))
      .catch(() => live && setLoadError("This image couldn’t be opened."));
    return () => {
      live = false;
    };
  }, [props.url]);

  // An image decoded before (stepped back to, or decoded ahead) shows at once.
  const photo =
    source?.url === props.url ? source.photo : props.url ? decodedPhoto(props.url) : undefined;
  if (!photo || props.loading || props.error) {
    const error = props.error || loadError;
    return (
      <EditorFrame name={props.name} onClose={props.onClose}>
        <TopBar
          aria-label="Image"
          start={<EditorTitle name={props.name} indexLabel={props.indexLabel} />}
        >
          <IconButton label="Close" shortcut="Esc" onClick={props.onClose}>
            <X />
          </IconButton>
        </TopBar>
        {error ? (
          <div className="grid min-h-0 flex-1 place-items-center p-8">
            <props.Error
              error={error}
              scope="files:photo-editor"
              title="Image could not be opened"
            />
          </div>
        ) : (
          <div role="status" aria-label="Image" className="flex min-h-0 flex-1 gap-2 px-3 pb-3">
            <Skeleton className="w-1/4 rounded-sm" />
            <Skeleton className="flex-1 rounded-sm" />
            <Skeleton className="w-1/4 rounded-sm" />
          </div>
        )}
      </EditorFrame>
    );
  }
  return <PhotoEditorSession key={props.sourceKey} {...props} photo={photo} />;
}
