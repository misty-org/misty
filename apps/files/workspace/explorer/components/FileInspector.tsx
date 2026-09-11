import type { ComponentProps } from "react";
import { FileInspectorView } from "./FileInspectorView";
import {
  useFilePreview,
  useFileMetadata,
  useFolderPreview,
} from "./FileInspectorPreview";
import { useHostPreviewRuntime } from "./globalPreview/hostPreviewRuntime";
export type { FileInspectorProps } from "./FileInspectorView";
export function FileInspector(
  props: ComponentProps<typeof FileInspectorView> extends infer P
    ? Omit<P, "runtime">
    : never,
) {
  const runtime = {
    useFilePreview,
    useFileMetadata,
    useFolderPreview,
    preview: useHostPreviewRuntime(),
  };
  return <FileInspectorView {...props} runtime={runtime} />;
}
