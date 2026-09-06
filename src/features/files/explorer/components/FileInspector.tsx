import type { ComponentProps } from "react";
import { FileInspectorView } from "./FileInspectorView";
import { useFilePreview, useFileMetadata, useFolderPreview } from "./FileInspectorPreview";
import { hostPreviewRuntime } from "./globalPreview/hostPreviewRuntime";
export type { FileInspectorProps } from "./FileInspectorView";
const runtime = { useFilePreview, useFileMetadata, useFolderPreview, preview: hostPreviewRuntime };
export function FileInspector(props: ComponentProps<typeof FileInspectorView> extends infer P ? Omit<P, "runtime"> : never) {
  return <FileInspectorView {...props} runtime={runtime} />;
}
