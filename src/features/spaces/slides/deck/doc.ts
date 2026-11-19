import * as Y from "yjs";
import { layoutSpec } from "./layouts";
import { readRichText, richTextIsEmpty, richToMarkdown } from "./richText";
import {
  isDeckThemeId,
  isSlideLayoutId,
  type DeckOutline,
  type DeckOutlineSlide,
  type DeckThemeId,
  type SlideLayoutId,
  type SlotEmbed,
  type SlotName,
} from "./types";

/**
 * Reading a deck's room: its Yjs layout (contract "Deck"), its slides in order and what each
 * holds. The changes to it are in model.ts, which re-exports everything here.
 */

export const deckKeys = {
  meta: "deck:meta",
  order: "deck:order",
  slides: "deck:slides",
} as const;

/** The origin of this person's own deck changes: their undo history tracks exactly these. */
export const deckEditOrigin = { source: "misty-deck-edit" } as const;

export const MAX_TEXT_FIELD = 20_000;

export interface DeckParts {
  meta: Y.Map<unknown>;
  order: Y.Array<string>;
  slides: Y.Map<Y.Map<unknown>>;
}

export function deckParts(doc: Y.Doc): DeckParts {
  return {
    meta: doc.getMap<unknown>(deckKeys.meta),
    order: doc.getArray<string>(deckKeys.order),
    slides: doc.getMap<Y.Map<unknown>>(deckKeys.slides),
  };
}

export class DeckOpError extends Error {
  constructor(
    message: string,
    /** The op that was refused, counting from 0; nothing was applied. */
    readonly index: number,
  ) {
    super(message);
    this.name = "DeckOpError";
  }
}

export interface DeckWriteOptions {
  /** The transaction origin; the editor passes `deckEditOrigin` so undo can find it. */
  origin?: unknown;
  /** The Space level's `deck_slides` limit, when it has one. */
  maxSlides?: number;
}

// ------------------------------------------------------------------------------------------
// Reading.

/** The slide ids in order, each once, skipping any whose slide is gone. */
export function slideIdsInOrder(doc: Y.Doc): string[] {
  const { order, slides } = deckParts(doc);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of order.toArray()) {
    if (typeof id !== "string" || seen.has(id) || !slides.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function readDeckTheme(doc: Y.Doc): DeckThemeId {
  const theme = deckParts(doc).meta.get("theme");
  return isDeckThemeId(theme) ? theme : "misty";
}

export function readDeckTitle(doc: Y.Doc): string {
  const title = deckParts(doc).meta.get("title");
  return typeof title === "string" ? title : "";
}

export function slideLayout(slide: Y.Map<unknown>): SlideLayoutId {
  const layout = slide.get("layout");
  return isSlideLayoutId(layout) ? layout : "bullets";
}

export function slideSlots(slide: Y.Map<unknown>): Y.Map<unknown> | null {
  const slots = slide.get("slots");
  return slots instanceof Y.Map ? slots : null;
}

export function slideNotes(slide: Y.Map<unknown>): Y.Text | null {
  const notes = slide.get("notes");
  return notes instanceof Y.Text ? notes : null;
}

export function readEmbed(value: unknown): SlotEmbed | null {
  if (!(value instanceof Y.Map)) return null;
  const json = value.toJSON() as Record<string, unknown>;
  if (json.type === "image" && typeof json.asset_id === "string") {
    return {
      type: "image",
      asset_id: json.asset_id,
      ...(typeof json.focal_x === "number" ? { focal_x: json.focal_x } : {}),
      ...(typeof json.focal_y === "number" ? { focal_y: json.focal_y } : {}),
    };
  }
  if (
    (json.type === "data-chart" || json.type === "data-range" || json.type === "board-frame") &&
    typeof json.item_id === "string" &&
    typeof json.part_id === "string"
  ) {
    return {
      type: json.type,
      item_id: json.item_id,
      part_id: json.part_id,
      title: typeof json.title === "string" ? json.title : "",
    };
  }
  return null;
}

/** Whether a slot holds something worth keeping: text with words in it, or an embed. */
export function slotHasContent(value: unknown): boolean {
  if (value instanceof Y.XmlFragment) return !richTextIsEmpty(readRichText(value));
  return readEmbed(value) !== null;
}

/** The deck as agents read it: slide ids, layouts, each slot's markdown or embed, and notes. */
export function readDeckOutline(doc: Y.Doc): DeckOutline {
  const { slides } = deckParts(doc);
  return {
    title: readDeckTitle(doc),
    theme: readDeckTheme(doc),
    slides: slideIdsInOrder(doc).map((id) => outlineSlide(id, slides.get(id)!)),
  };
}

function outlineSlide(id: string, slide: Y.Map<unknown>): DeckOutlineSlide {
  const layout = slideLayout(slide);
  const shown = new Set<string>(layoutSpec(layout).slots.map((slot) => slot.name));
  const result: DeckOutlineSlide = {
    id,
    layout,
    hidden: slide.get("hidden") === true,
    slots: {},
    kept: [],
    notes: slideNotes(slide)?.toString() ?? "",
  };
  const slots = slideSlots(slide);
  slots?.forEach((value, name) => {
    const slotName = name as SlotName;
    if (value instanceof Y.XmlFragment) {
      const text = richToMarkdown(readRichText(value));
      if (!shown.has(name) && !text.trim()) return;
      result.slots[slotName] = text;
    } else {
      const embed = readEmbed(value);
      if (!embed) return;
      result.slots[slotName] = embed;
    }
    if (!shown.has(name)) result.kept.push(slotName);
  });
  return result;
}

// ------------------------------------------------------------------------------------------
// Writing.
