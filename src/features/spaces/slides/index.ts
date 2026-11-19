// Slides: what the rest of the app imports. The page itself is lazy-loaded from SpaceSlides.tsx.
export { SpaceSlides, type SpaceSlidesProps } from "./SpaceSlides";
export {
  decksApi,
  spaceDecksPath,
  type DeckCollaborationTicket,
  type DeckRole,
  type SpaceDeck,
} from "./api";
export {
  acquireDeckSession,
  closeDeckCollaborationSession,
  realtimeDeckEvent,
  releaseDeckSession,
  whenDeckSynced,
  type DeckSession,
} from "./session";
export { notifyDeckListChanged, subscribeToDeckListChanges } from "./deckEvents";
export { useSpaceDecks } from "./hooks/useSpaceDecks";
export {
  applyDeckOps,
  createDeck,
  deckEditOrigin,
  deckKeys,
  DeckOpError,
  readDeckOutline,
  type DeckWriteOptions,
} from "./deck/model";
export { lintDeck, MAX_BULLETS } from "./deck/lint";
export { slideLayouts, SLIDE_HEIGHT, SLIDE_WIDTH } from "./deck/layouts";
export { deckThemes, deckThemeList } from "./deck/themes";
export { markdownToRich, readRichText, richToMarkdown, writeRichText } from "./deck/richText";
export type {
  DeckInput,
  DeckLint,
  DeckLintKind,
  DeckOp,
  DeckOpsResult,
  DeckOutline,
  DeckOutlineSlide,
  DeckOutlineSlot,
  DeckThemeId,
  SlideInput,
  SlideLayoutId,
  SlotEmbed,
  SlotName,
  VisualInput,
} from "./deck/types";
export { deckThemeIds, slideLayoutIds } from "./deck/types";
export { exportDeckPptx, downloadDeckPptx } from "./export/pptx";
export { exportDeckPdf, downloadDeckPdf } from "./export/pdf";
export type { DeckExportInput } from "./export/exportShared";
export { slidesFromDoc, type SlidesFromDocResult } from "./slidesFromDoc";
