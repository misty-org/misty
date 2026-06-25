import { runtimeProperty } from "@/shared/lib/runtimeProperty";
import type { spacesApi } from "@/api/spaces/api";
import type { useSpacesStore } from "@/features/spaces";
import type { useWorkspaceTabTitle, useWorkspaceTabFocused } from "@/features/workspace";
import type { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import type { useShortcutHandler } from "@/features/shortcuts";
import type { MistyFilePicker } from "@/features/picker";
import type { SystemErrorActivity } from "@/features/activity";
import type { EmbeddedUniversalPreview } from "@/features/files/explorer";
import type { PhotoEditor } from "@/features/editor";
export interface LibraryRuntime {
  api: typeof spacesApi;
  useSpacesStore: typeof useSpacesStore;
  useWorkspaceTabTitle: typeof useWorkspaceTabTitle;
  useWorkspaceTabFocused: typeof useWorkspaceTabFocused;
  useAiSurfaceAdapter: typeof useAiSurfaceAdapter;
  useShortcutHandler(id: string, handler: () => boolean | void, enabled?: boolean): void;
  Picker: typeof MistyFilePicker;
  Error: React.ComponentType<React.ComponentProps<typeof SystemErrorActivity>>;
  Preview: typeof EmbeddedUniversalPreview;
  PhotoEditor: typeof PhotoEditor;
  confirm(message: string, title?: string): Promise<boolean>;
  copyFiles(files: Array<{ name: string; blob: Blob }>): Promise<void>;
}
let current: LibraryRuntime | undefined;
export function configureLibraryRuntime(runtime: LibraryRuntime) {
  current = runtime;
  return () => {
    if (current === runtime) current = undefined;
  };
}
export function libraryRuntime(): LibraryRuntime {
  if (!current) throw new Error("Library services have not been mounted.");
  return current;
}
export const libraryApi = new Proxy({} as typeof spacesApi, {
  get: (target, key) => runtimeProperty(target, key, () => libraryRuntime().api[key as keyof typeof spacesApi]),
});
export const useLibrarySpaces = new Proxy(
  ((selector: Parameters<typeof useSpacesStore>[0]) =>
    libraryRuntime().useSpacesStore(selector)) as typeof useSpacesStore,
  { get: (target, key) => runtimeProperty(target, key, () => libraryRuntime().useSpacesStore[key as keyof typeof useSpacesStore]) },
);
export const useLibraryTitle: typeof useWorkspaceTabTitle = (...args) =>
  libraryRuntime().useWorkspaceTabTitle(...args);
export const useLibraryFocused: typeof useWorkspaceTabFocused = (...args) =>
  libraryRuntime().useWorkspaceTabFocused(...args);
export const useLibraryAi: typeof useAiSurfaceAdapter = (...args) =>
  libraryRuntime().useAiSurfaceAdapter(...args);
export const useLibraryShortcut: LibraryRuntime["useShortcutHandler"] = (...args) =>
  libraryRuntime().useShortcutHandler(...args);
export const confirmLibraryAction = (message: string, title?: string) =>
  libraryRuntime().confirm(message, title);
export const LibraryPicker = (props: React.ComponentProps<typeof MistyFilePicker>) => {
  const View = libraryRuntime().Picker;
  return <View {...props} />;
};
export const LibraryError = (props: React.ComponentProps<typeof SystemErrorActivity>) => {
  const View = libraryRuntime().Error;
  return <View {...props} />;
};
export const LibraryPreview = (props: React.ComponentProps<typeof EmbeddedUniversalPreview>) => {
  const View = libraryRuntime().Preview;
  return <View {...props} />;
};
export const LibraryPhotoEditor = (props: React.ComponentProps<typeof PhotoEditor>) => {
  const View = libraryRuntime().PhotoEditor;
  return <View {...props} />;
};
