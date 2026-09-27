/**
 * The Explorer's file preview.
 *
 * Implementations live in `globalPreview/`; this file stays as the import path
 * the Explorer and Spaces Library already use.
 */
export type { GlobalPreviewSource, PreviewResource } from "@/features/file-ui";
export type { GlobalPreviewKind } from "@/features/file-ui";

export { EmbeddedUniversalPreview } from "@/features/resource-preview";
export { GlobalPreviewDialog } from "./globalPreview/GlobalPreviewDialog";
export { globalPreviewKindForSource } from "./globalPreview/useGlobalPreviewResource";
