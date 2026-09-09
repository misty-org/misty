import { spacesApi } from "@/api/spaces/api";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceTabTitle, useWorkspaceTabFocused } from "@/features/workspace";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useShortcutHandler } from "@/features/shortcuts";
import { MistyFilePicker } from "@/features/picker";
import { SystemErrorActivity } from "@/features/activity";
import { EmbeddedUniversalPreview } from "@/features/files/explorer";
import { PhotoEditor } from "@/features/editor";
import { confirmAction } from "@/shared/lib/confirmAction";
import { clipboardWriteFileBytes } from "@/native";
import { configureLibraryRuntime } from "./libraryRuntime";
export function initializeHostLibraryRuntime() {
  configureLibraryRuntime({
    api: spacesApi,
    useSpacesStore,
    useWorkspaceTabTitle,
    useWorkspaceTabFocused,
    useAiSurfaceAdapter,
    useShortcutHandler,
    Picker: MistyFilePicker,
    Error: SystemErrorActivity,
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
