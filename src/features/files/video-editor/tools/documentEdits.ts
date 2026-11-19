import type { VideoProjectDocument } from "../projectDocumentTypes";

/**
 * Edits that work on the whole project document rather than one scene's tracks: they may read
 * media (to probe it, analyse it, or swap it), and each lives in its own module. `edits.ts`
 * runs them in order with the rest.
 */
export interface EditContext {
  /** Reads one of the Space's Media items. */
  loadMedia(itemId: string): Promise<File>;
}

export type DocumentEditHandler<E> = (
  document: VideoProjectDocument,
  edit: E,
  context: EditContext,
) => Promise<VideoProjectDocument>;
