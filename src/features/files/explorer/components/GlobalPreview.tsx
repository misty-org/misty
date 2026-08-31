/**
 * The Explorer's file preview.
 *
 * Implementations live in `globalPreview/`; this file stays as the import path
 * the Explorer and Spaces Library already use.
 */
export type {
  GlobalPreviewSource,
  PreviewResource,
} from "../model/interfaces/components/GlobalPreview";
export type { GlobalPreviewKind } from "../model/types/components/GlobalPreview";

export { EmbeddedUniversalPreview } from "./globalPreview/EmbeddedUniversalPreview";
export { GlobalPreviewDialog } from "./globalPreview/GlobalPreviewDialog";
export { globalPreviewKindForSource } from "./globalPreview/useGlobalPreviewResource";
