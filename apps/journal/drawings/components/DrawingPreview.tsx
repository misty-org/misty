import { reportSystemError } from "@/features/activity";
import type { AuthUser } from "@/features/auth";
import { useMemo } from "react";
import { hydrateDrawingBinaryFile } from "../drawingAssets";
import { useDrawingRoom } from "../hooks/useDrawingRoom";
import type { SpaceDrawing } from "../types";
import { DrawingPreviewView, type DrawingPreviewRuntime } from "./DrawingPreviewView";
export function DrawingPreview(props: { drawing: SpaceDrawing; user: AuthUser }) {
  const runtime = useMemo<DrawingPreviewRuntime>(
    () => ({
      useRoom: (space, id, _user, options) => useDrawingRoom(space, id, props.user, options),
      hydrate: hydrateDrawingBinaryFile,
      exportFile: async (blob, filename) => downloadBlob(blob, filename),
      copyImage: async (blob) =>
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]),
      reportError: reportSystemError,
    }),
    [props.user],
  );
  return <DrawingPreviewView {...props} runtime={runtime} />;
}

function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
