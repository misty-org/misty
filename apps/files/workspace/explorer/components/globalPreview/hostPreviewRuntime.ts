import { SystemErrorActivity } from "@/features/activity";
import {
  explorerOpenPath,
  explorerSavePreviewItem,
} from "@/features/files/native";
import { useShortcutHandler } from "@/features/shortcuts";
import type { PreviewRuntime } from "./PreviewRuntime";
import { useHostDocumentLoader } from "./useGlobalPreviewResource";
import { useMemo } from "react";
export function useHostPreviewRuntime(): PreviewRuntime {
  const load = useHostDocumentLoader();
  return useMemo(
    () => ({
      Error: SystemErrorActivity,
      load,
      async save(source, bytes, copy) {
        const result = await explorerSavePreviewItem({
          path: source.path,
          bytes: [...bytes],
          saveAsCopy: copy,
        });
        return result.affectedPaths[0] ?? source.path;
      },
      open: (source) => explorerOpenPath(source.path),
      useSaveShortcut(save, enabled) {
        useShortcutHandler("explorer.preview_save", save, enabled);
      },
    }),
    [load],
  );
}
