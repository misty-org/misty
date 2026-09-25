import { useMemo } from "react";
import { SystemErrorActivity } from "@/features/activity";
import { selectAppearancePreferences, useSettingsStore } from "@/features/settings";
import { FileBrowserView } from "./FileBrowserView";
import { FileBrowserRuntimeProvider } from "./fileBrowser/FileBrowserRuntime";
import { prewarmGridThumbnails, requestGridThumbnail } from "./fileBrowser/gridThumbnails";
import type { FileBrowserProps } from "../model/interfaces/components/FileBrowser";
export type {
  FileBrowserProps,
  GridThumbnailJob,
  FileTableColumn,
  FileTableColumnWidths,
  GridThumbnailSubscriber,
  FileBrowserDragItem,
} from "./FileBrowserView";

function ErrorView({ error, paneId }: { error: string; paneId: string }) {
  return (
    <SystemErrorActivity
      error={error}
      scope={`files:browser:${paneId}`}
      title="Files could not be loaded"
      target={{ kind: "workspace-tool", tool: "files" }}
    />
  );
}
export function FileBrowser(props: FileBrowserProps) {
  const thumbnailPreviewsEnabled = useSettingsStore(
    (state) => selectAppearancePreferences(state.settings?.document).thumbnailPreviewsEnabled,
  );
  const compactModeEnabled = useSettingsStore(
    (state) => selectAppearancePreferences(state.settings?.document).compactModeEnabled,
  );
  const runtime = useMemo(
    () => ({
      thumbnailPreviewsEnabled,
      compactModeEnabled,
      prewarmThumbnails: prewarmGridThumbnails,
      requestThumbnail: requestGridThumbnail,
      Error: ErrorView,
    }),
    [thumbnailPreviewsEnabled, compactModeEnabled],
  );
  return (
    <FileBrowserRuntimeProvider value={runtime}>
      <FileBrowserView {...props} />
    </FileBrowserRuntimeProvider>
  );
}
