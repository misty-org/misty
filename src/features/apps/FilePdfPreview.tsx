import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { MistyFilePdfPreview, MistyFileRenderer, MistyFileWorkspaceOptions } from "@misty/sdk";
import type { PreviewErrorComponent } from "@/features/files/explorer/components/globalPreview/PreviewRuntime";

export const FilePreviewRenderersContext = createContext<
  Pick<
    MistyFileWorkspaceOptions,
    "renderPdf" | "renderPhoto" | "renderVideo" | "extractDocumentText"
  >
>({});

/** The host owns the view lifetime; rendering engines belong to Files. */
export function FilePreviewMount<T>({
  render,
  preview,
}: {
  render: MistyFileRenderer<T> | undefined;
  preview: T;
}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(preview);
  latest.current = preview;
  const mounted = useRef<ReturnType<MistyFileRenderer<T>> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    setError(null);
    if (!render || !root.current) return;
    // Give each renderer a distinct container, including StrictMode's remount.
    const container = document.createElement("div");
    container.className = "h-full min-h-0 w-full";
    root.current.append(container);
    try {
      mounted.current = render(container, latest.current);
    } catch (cause) {
      container.remove();
      setError(String(cause));
    }
    return () => {
      const previous = mounted.current;
      mounted.current = undefined;
      container.remove();
      // React cannot synchronously unmount another root during this root's commit.
      queueMicrotask(() => previous?.unmount());
    };
  }, [render]);
  useLayoutEffect(() => {
    try {
      mounted.current?.update(preview);
    } catch (cause) {
      setError(String(cause));
    }
  }, [preview]);
  return (
    <div className="h-full min-h-0 w-full">
      {(!render || error) && (
        <div role="alert" className="p-3 text-sm text-cream-muted">
          {error ?? "Update Files to load its preview tools."}
        </div>
      )}
      <div ref={root} className="h-full min-h-0 w-full" />
    </div>
  );
}
export default function FilePdfPreview({
  Error: _Error,
  ...preview
}: MistyFilePdfPreview & {
  Error: PreviewErrorComponent;
}) {
  return (
    <FilePreviewMount
      render={useContext(FilePreviewRenderersContext).renderPdf}
      preview={preview}
    />
  );
}
