import { spacesApi } from "@/api/spaces/api";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceViewTitle, useWorkspaceViewFocused } from "@/features/workspace";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useShortcutHandler } from "@/features/shortcuts";
import { MistyFilePicker } from "@/features/picker";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import { EmbeddedUniversalPreview } from "@/features/resource-preview/EmbeddedUniversalPreview";
import { PhotoEditor } from "@/features/editor";
import { confirmAction } from "@/shared/lib/confirmAction";
import { clipboardWriteFileBytes } from "@/native";
import { configureLibraryRuntime } from "./LibraryRuntime";
export function initializeHostLibraryRuntime() {
  configureLibraryRuntime({
    api: spacesApi,
    useSpacesStore,
    useWorkspaceViewTitle: useWorkspaceViewTitle,
    useWorkspaceViewFocused: useWorkspaceViewFocused,
    useAiSurfaceAdapter,
    useShortcutHandler,
    Picker: MistyFilePicker,
    Error: SystemErrorNotice,
    Preview: EmbeddedUniversalPreview,
    PhotoEditor,
    confirm: confirmAction,
    async copyFiles(files) {
      const copied = await clipboardWriteFileBytes(
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
          })),
        ),
      );
      if (!copied) throw new Error("The files could not be copied.");
    },
  });
}
