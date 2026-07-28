/**
 * The Explorer's file preview.
 *
 * Implementations live in `globalPreview/`; this file stays as the import path
 * the Explorer and Spaces Library already use.
 */
export type { GlobalPreviewKind } from "@/models/types/features/explorer/components/GlobalPreview";
export type {
  GlobalPreviewSource,
  PreviewResource,
} from "@/models/interfaces/features/explorer/components/GlobalPreview";

export { GlobalPreviewDialog } from "./globalPreview/GlobalPreviewDialog";
export { EmbeddedUniversalPreview } from "./globalPreview/EmbeddedUniversalPreview";
export { globalPreviewKindForSource } from "./globalPreview/useGlobalPreviewResource";
