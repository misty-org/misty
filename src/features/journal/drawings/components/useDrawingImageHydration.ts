import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef } from "react";
import type { CollaborativeDrawingCanvasProps } from "./collaborativeDrawingCanvasTypes";

/** Loads images referenced by the shared session into the open Excalidraw scene. */
export function useDrawingImageHydration(
  props: CollaborativeDrawingCanvasProps,
  api: ExcalidrawImperativeAPI | null,
) {
  const hydrateImage = props.runtime.hydrate;
  const fileHydrationsRef = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    if (!api) return;
    let active = true;
    const hydrateFiles = () => {
      for (const reference of props.session.files.values()) {
        if (api.getFiles()[reference.fileId] || fileHydrationsRef.current.has(reference.fileId)) {
          continue;
        }
        const hydration = hydrateImage(props.drawing.space_id, props.drawing.id, reference)
          .then((file) => {
            if (active) api.addFiles([file]);
          })
          .catch((cause) => {
            if (!active) return;
            api.setToast({
              message:
                cause instanceof Error ? cause.message : "A shared image could not be loaded.",
              duration: 4000,
            });
          })
          .finally(() => {
            fileHydrationsRef.current.delete(reference.fileId);
          });
        fileHydrationsRef.current.set(reference.fileId, hydration);
      }
    };
    props.session.files.observe(hydrateFiles);
    hydrateFiles();
    return () => {
      active = false;
      props.session.files.unobserve(hydrateFiles);
    };
  }, [api, props.drawing.id, props.drawing.space_id, props.session.files, hydrateImage]);
}
