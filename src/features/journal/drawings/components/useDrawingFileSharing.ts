import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef } from "react";
import { localDrawingOrigin } from "../collaboration/drawingSceneStore";
import type { DrawingRole } from "../types";
import type { CollaborativeDrawingCanvasProps } from "./collaborativeDrawingCanvasTypes";

/** Uploads local images once per file id and records their references in the shared session. */
export function useDrawingFileSharing(props: CollaborativeDrawingCanvasProps, role: DrawingRole) {
  const uploadImage = props.runtime.upload;
  const currentSession = useRef({ session: props.session, role });
  currentSession.current = { session: props.session, role };
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const fileUploadsRef = useRef(new Map<string, Promise<void>>());

  const shareBinaryFiles = useCallback(
    async (files: readonly BinaryFileData[]) => {
      if (role === "viewer") return;
      await Promise.all(
        files.map(async (file) => {
          if (props.session.files.has(file.id)) return;
          const active = fileUploadsRef.current.get(file.id);
          if (active) return active;
          const upload = uploadImage(props.drawing.space_id, props.drawing.id, file)
            .then((reference) => {
              if (
                !activeRef.current ||
                props.session.doc.isDestroyed ||
                currentSession.current.session.key !== props.session.key ||
                currentSession.current.role === "viewer"
              )
                return;
              props.session.doc.transact(() => {
                props.session.files.set(file.id, reference);
              }, localDrawingOrigin);
            })
            .finally(() => {
              fileUploadsRef.current.delete(file.id);
            });
          fileUploadsRef.current.set(file.id, upload);
          return upload;
        }),
      );
    },
    [props.drawing.id, role, props.drawing.space_id, props.session, uploadImage],
  );

  return shareBinaryFiles;
}
