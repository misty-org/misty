/**
 * The deck's shapes, as the room stores them (docs/plans/space-artifacts-contract.md, "Deck"):
 * the editor, the tool host and the Worker's projection all read these names.
 */

export const deckThemeIds = ["misty", "paper", "ink", "plain", "forest", "signal"] as const;
export type DeckThemeId = (typeof deckThemeIds)[number];

export const slideLayoutIds = [
  "title",
  "section",
  "bullets",
  "two-columns",
  "text-visual",
  "visual-text",
  "full-visual",
  "big-number",
  "quote",
] as const;
export type SlideLayoutId = (typeof slideLayoutIds)[number];

export const textSlotNames = [
  "kicker",
  "title",
  "subtitle",
  "body",
  "left",
  "right",
  "caption",
  "number",
  "label",
  "quote",
  "attribution",
] as const;
export type TextSlotName = (typeof textSlotNames)[number];
export type SlotName = TextSlotName | "visual";
export const slotNames: readonly SlotName[] = [...textSlotNames, "visual"];

export type LiveEmbedType = "data-chart" | "data-range" | "board-frame";

/** An image slot: a deck asset and the point that stays in view when it is cropped (0 to 1). */
export interface ImageEmbed {
  type: "image";
  asset_id: string;
  focal_x?: number;
  focal_y?: number;
}

/** A live Data chart, Data range or Whiteboard frame (plan F4). */
export interface LiveEmbedRef {
  type: LiveEmbedType;
  item_id: string;
  part_id: string;
  title: string;
}

export type SlotEmbed = ImageEmbed | LiveEmbedRef;

/** One run of text inside a paragraph or bullet, with its marks. */
export interface RichRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

/** A text slot's content, flattened: paragraphs and bullets two levels deep. */
export type RichBlock =
  { kind: "paragraph"; runs: RichRun[] } | { kind: "bullet"; level: 0 | 1; runs: RichRun[] };

/** How an agent or the editor gives a visual: an uploaded image or a live part of another item. */
export type VisualInput =
  | { image_asset_id: string; focal_x?: number; focal_y?: number }
  | { data_chart: { item_id: string; part_id: string; title?: string } }
  | { data_range: { item_id: string; part_id: string; title?: string } }
  | { board_frame: { item_id: string; part_id: string; title?: string } }
  | SlotEmbed;

/** A slide as `deck.create` and `insert_slide` take it. Text fields are markdown. */
export interface SlideInput {
  layout: SlideLayoutId;
  hidden?: boolean;
  kicker?: string;
  title?: string;
  subtitle?: string;
  /** Markdown: paragraphs, `- ` bullets (two spaces in for the second level), **bold**, *italic*, [links](https://…). */
  body?: string;
  left?: string;
  right?: string;
  caption?: string;
  number?: string;
  label?: string;
  quote?: string;
  attribution?: string;
  /** `null` removes the slide's visual (in `update_slide`). */
  visual?: VisualInput | null;
  notes?: string;
}

export type SlideFields = Partial<SlideInput>;

export interface DeckInput {
  title?: string;
  theme?: DeckThemeId;
  slides: SlideInput[];
}

/** `after` is the slide to follow; left out (or null) puts the slide first. */
export type DeckOp =
  | { op: "insert_slide"; after?: string | null; slide: SlideInput }
  | { op: "update_slide"; id: string; fields: SlideFields }
  | { op: "move_slide"; id: string; after?: string | null }
  | { op: "delete_slide"; id: string }
  | { op: "set_theme"; theme: DeckThemeId };

/** What `createDeck` and `applyDeckOps` hand back: the deck's slides in order, and the new ones. */
export interface DeckOpsResult {
  slides: { id: string; layout: SlideLayoutId }[];
  inserted: string[];
}

/** A slot in the outline: a text slot's markdown, or the embed map it holds. */
export type DeckOutlineSlot = string | SlotEmbed;

export interface DeckOutlineSlide {
  id: string;
  layout: SlideLayoutId;
  hidden: boolean;
  slots: Partial<Record<SlotName, DeckOutlineSlot>>;
  /** Slots that hold something the layout doesn't show; switching back shows them again. */
  kept: SlotName[];
  notes: string;
}

export interface DeckOutline {
  title: string;
  theme: DeckThemeId;
  slides: DeckOutlineSlide[];
}

export type DeckLintKind = "overflow" | "empty" | "crowded" | "missing_image";

export interface DeckLint {
  slide_id: string;
  slot?: SlotName;
  kind: DeckLintKind;
  message: string;
}

export function isDeckThemeId(value: unknown): value is DeckThemeId {
  return typeof value === "string" && (deckThemeIds as readonly string[]).includes(value);
}

export function isSlideLayoutId(value: unknown): value is SlideLayoutId {
  return typeof value === "string" && (slideLayoutIds as readonly string[]).includes(value);
}

export function isTextSlotName(value: unknown): value is TextSlotName {
  return typeof value === "string" && (textSlotNames as readonly string[]).includes(value);
}
