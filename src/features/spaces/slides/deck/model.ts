import * as Y from "yjs";
import { layoutHasVisual, layoutSpec, slotAliases, textSlots } from "./layouts";
import { markdownToRich, readRichText, writeRichText } from "./richText";
import {
  isDeckThemeId,
  isSlideLayoutId,
  isTextSlotName,
  textSlotNames,
  type DeckInput,
  type DeckOp,
  type DeckOpsResult,
  type ImageEmbed,
  type LiveEmbedType,
  type SlideFields,
  type SlideInput,
  type SlideLayoutId,
  type SlotEmbed,
  type TextSlotName,
  type VisualInput,
} from "./types";
import {
  MAX_TEXT_FIELD,
  type DeckParts,
  deckParts,
  DeckOpError,
  type DeckWriteOptions,
  slideIdsInOrder,
  readDeckTheme,
  slideLayout,
  slideSlots,
  slideNotes,
  readEmbed,
  slotHasContent,
} from "./doc";

/**
 * The deck model: the room's Yjs layout (contract "Deck") and every change made to it. The
 * editor and the agent tools both go through here, on a bare `Y.Doc` with nothing mounted, so
 * this file needs no React and no DOM. Every call is one Yjs transaction, so it merges with
 * people editing at the same time instead of overwriting them.
 */

export * from "./doc";

/**
 * Fills a deck: its title, theme and slides, replacing whatever the room held. Returns the
 * slides in order and their ids.
 */
export function createDeck(
  doc: Y.Doc,
  input: DeckInput,
  options: DeckWriteOptions = {},
): DeckOpsResult {
  const slides = Array.isArray(input?.slides) ? input.slides : [];
  if (input.theme !== undefined && !isDeckThemeId(input.theme))
    throw new DeckOpError(`Unknown theme "${String(input.theme)}".`, -1);
  if (options.maxSlides !== undefined && slides.length > options.maxSlides)
    throw new DeckOpError(`A deck holds at most ${options.maxSlides} slides.`, -1);
  slides.forEach((slide, index) => validateSlideInput(slide, index, true));
  const inserted: string[] = [];
  doc.transact(() => {
    const parts = deckParts(doc);
    if (typeof input.title === "string") parts.meta.set("title", input.title.slice(0, 500));
    parts.meta.set("theme", input.theme ?? readDeckTheme(doc));
    if (parts.order.length) parts.order.delete(0, parts.order.length);
    for (const key of [...parts.slides.keys()]) parts.slides.delete(key);
    for (const slide of slides) {
      const id = newSlideId();
      writeNewSlide(parts, id, slide);
      parts.order.push([id]);
      inserted.push(id);
    }
  }, options.origin ?? null);
  return result(doc, inserted);
}

/**
 * Applies ops in one transaction. Every op is checked first against the deck as the earlier
 * ops leave it; if one is refused nothing is applied and a `DeckOpError` names it.
 */
export function applyDeckOps(
  doc: Y.Doc,
  ops: DeckOp[],
  options: DeckWriteOptions = {},
): DeckOpsResult {
  if (!Array.isArray(ops)) throw new DeckOpError("ops must be a list.", -1);
  const planned = planOps(doc, ops, options);
  const inserted: string[] = [];
  doc.transact(() => {
    const parts = deckParts(doc);
    ops.forEach((op, index) => {
      switch (op.op) {
        case "insert_slide": {
          const id = planned.insertIds[index];
          writeNewSlide(parts, id, op.slide);
          placeInOrder(parts, id, op.after ?? null);
          inserted.push(id);
          break;
        }
        case "update_slide":
          updateSlide(parts.slides.get(op.id)!, op.fields);
          break;
        case "move_slide":
          placeInOrder(parts, op.id, op.after ?? null);
          break;
        case "delete_slide":
          removeFromOrder(parts, op.id);
          parts.slides.delete(op.id);
          break;
        case "set_theme":
          parts.meta.set("theme", op.theme);
          break;
      }
    });
  }, options.origin ?? null);
  return result(doc, inserted);
}

/** A copy of a slide right after it, every slot and the notes included. Returns the new id. */
export function duplicateSlide(doc: Y.Doc, id: string, options: DeckWriteOptions = {}): string {
  const { slides } = deckParts(doc);
  const source = slides.get(id);
  if (!source) throw new DeckOpError("That slide is gone.", 0);
  const copyId = newSlideId();
  doc.transact(() => {
    const parts = deckParts(doc);
    const slide = new Y.Map<unknown>();
    parts.slides.set(copyId, slide);
    slide.set("layout", slideLayout(source));
    slide.set("hidden", source.get("hidden") === true);
    const slots = new Y.Map<unknown>();
    slide.set("slots", slots);
    slideSlots(source)?.forEach((value, name) => {
      if (value instanceof Y.XmlFragment) {
        const fragment = new Y.XmlFragment();
        slots.set(name, fragment);
        writeRichText(fragment, readRichText(value));
      } else {
        const embed = readEmbed(value);
        if (embed) slots.set(name, embedMap(embed));
      }
    });
    slide.set("notes", new Y.Text(slideNotes(source)?.toString() ?? ""));
    placeInOrder(parts, copyId, id);
  }, options.origin ?? null);
  return copyId;
}

/** Shows or hides a slide in present mode and exports. */
export function setSlideHidden(
  doc: Y.Doc,
  id: string,
  hidden: boolean,
  options: DeckWriteOptions = {},
): void {
  const slide = deckParts(doc).slides.get(id);
  if (!slide) return;
  doc.transact(() => slide.set("hidden", hidden), options.origin ?? null);
}

/** Moves an image's focal point (0 to 1 across and down). */
export function setImageFocalPoint(
  doc: Y.Doc,
  id: string,
  focal: { x: number; y: number },
  options: DeckWriteOptions = {},
): void {
  const slide = deckParts(doc).slides.get(id);
  const visual = slide ? slideSlots(slide)?.get("visual") : null;
  if (!(visual instanceof Y.Map) || visual.get("type") !== "image") return;
  doc.transact(() => {
    visual.set("focal_x", clamp01(focal.x));
    visual.set("focal_y", clamp01(focal.y));
  }, options.origin ?? null);
}

/**
 * A text slot's fragment, made when the slide lacks it (a slot from a layout switched to by an
 * older client). The editor binds Tiptap to it.
 */
export function ensureTextSlot(
  doc: Y.Doc,
  id: string,
  name: TextSlotName,
  options: DeckWriteOptions = {},
): Y.XmlFragment | null {
  const slide = deckParts(doc).slides.get(id);
  if (!slide) return null;
  const existing = slideSlots(slide)?.get(name);
  if (existing instanceof Y.XmlFragment) return existing;
  let fragment: Y.XmlFragment | null = null;
  doc.transact(() => {
    const slots = ensureSlots(slide);
    fragment = new Y.XmlFragment();
    slots.set(name, fragment);
  }, options.origin ?? null);
  return fragment;
}

/** Notes text, made when the slide lacks it. */
export function ensureNotes(doc: Y.Doc, id: string): Y.Text | null {
  const slide = deckParts(doc).slides.get(id);
  if (!slide) return null;
  const existing = slideNotes(slide);
  if (existing) return existing;
  const notes = new Y.Text();
  // Not an edit to undo: the slide only gains its empty notes.
  doc.transact(() => slide.set("notes", notes), null);
  return notes;
}

// ------------------------------------------------------------------------------------------
// The checks before anything is written.

function planOps(doc: Y.Doc, ops: DeckOp[], options: DeckWriteOptions) {
  const ids = slideIdsInOrder(doc);
  const present = new Set(ids);
  let count = ids.length;
  const insertIds: Record<number, string> = {};
  ops.forEach((op, index) => {
    if (!op || typeof op !== "object") throw new DeckOpError("Each op must be an object.", index);
    const needSlide = (id: unknown, label: string) => {
      if (typeof id !== "string" || !present.has(id))
        throw new DeckOpError(`${label}: no slide with id "${String(id)}".`, index);
    };
    const needAfter = (after: unknown) => {
      if (after === undefined || after === null) return;
      needSlide(after, "after");
    };
    switch (op.op) {
      case "insert_slide": {
        needAfter(op.after);
        validateSlideInput(op.slide, index, true);
        count += 1;
        if (options.maxSlides !== undefined && count > options.maxSlides)
          throw new DeckOpError(`A deck holds at most ${options.maxSlides} slides.`, index);
        const id = newSlideId();
        insertIds[index] = id;
        present.add(id);
        break;
      }
      case "update_slide":
        needSlide(op.id, "update_slide");
        if (!op.fields || typeof op.fields !== "object")
          throw new DeckOpError("update_slide needs fields.", index);
        validateSlideInput(op.fields, index, false);
        break;
      case "move_slide":
        needSlide(op.id, "move_slide");
        needAfter(op.after);
        if (op.after === op.id) throw new DeckOpError("A slide can't move after itself.", index);
        break;
      case "delete_slide":
        needSlide(op.id, "delete_slide");
        present.delete(op.id);
        count -= 1;
        break;
      case "set_theme":
        if (!isDeckThemeId(op.theme))
          throw new DeckOpError(`Unknown theme "${String(op.theme)}".`, index);
        break;
      default:
        throw new DeckOpError(`Unknown op "${String((op as { op?: unknown }).op)}".`, index);
    }
  });
  return { insertIds };
}

function validateSlideInput(input: SlideFields | undefined, index: number, full: boolean): void {
  if (!input || typeof input !== "object")
    throw new DeckOpError("A slide must be an object.", index);
  if (full || input.layout !== undefined) {
    if (!isSlideLayoutId(input.layout))
      throw new DeckOpError(`Unknown layout "${String(input.layout)}".`, index);
  }
  if (input.hidden !== undefined && typeof input.hidden !== "boolean")
    throw new DeckOpError("hidden must be true or false.", index);
  for (const name of [...textSlotNames, "notes"] as const) {
    const value = input[name];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new DeckOpError(`${name} must be text.`, index);
    if (value.length > MAX_TEXT_FIELD)
      throw new DeckOpError(`${name} is longer than ${MAX_TEXT_FIELD} characters.`, index);
  }
  if (input.visual !== undefined && input.visual !== null && !normalizeVisual(input.visual))
    throw new DeckOpError(
      "visual must be { image_asset_id }, { data_chart }, { data_range } or { board_frame } with item_id and part_id.",
      index,
    );
}

/** A visual as the room stores it, from any of the shapes agents and the editor give. */
export function normalizeVisual(input: VisualInput | null | undefined): SlotEmbed | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const image = (assetId: string): ImageEmbed => {
    const embed: ImageEmbed = { type: "image", asset_id: assetId };
    if (typeof value.focal_x === "number" && Number.isFinite(value.focal_x))
      embed.focal_x = clamp01(value.focal_x);
    if (typeof value.focal_y === "number" && Number.isFinite(value.focal_y))
      embed.focal_y = clamp01(value.focal_y);
    return embed;
  };
  if (typeof value.image_asset_id === "string" && value.image_asset_id)
    return image(value.image_asset_id);
  if (value.type === "image" && typeof value.asset_id === "string" && value.asset_id)
    return image(value.asset_id);
  const live: [string, LiveEmbedType][] = [
    ["data_chart", "data-chart"],
    ["data_range", "data-range"],
    ["board_frame", "board-frame"],
  ];
  for (const [key, type] of live) {
    const ref = value[key] as Record<string, unknown> | undefined;
    if (ref && typeof ref === "object") return liveRef(type, ref);
  }
  if (value.type === "data-chart" || value.type === "data-range" || value.type === "board-frame")
    return liveRef(value.type, value);
  return null;
}

function liveRef(type: LiveEmbedType, ref: Record<string, unknown>): SlotEmbed | null {
  if (typeof ref.item_id !== "string" || !ref.item_id) return null;
  if (typeof ref.part_id !== "string" || !ref.part_id) return null;
  return {
    type,
    item_id: ref.item_id,
    part_id: ref.part_id,
    title: typeof ref.title === "string" ? ref.title.slice(0, 300) : "",
  };
}

// ------------------------------------------------------------------------------------------
// The writes themselves, inside the caller's transaction.

function writeNewSlide(parts: DeckParts, id: string, input: SlideInput): void {
  const slide = new Y.Map<unknown>();
  parts.slides.set(id, slide);
  let layout = input.layout;
  const visual = normalizeVisual(input.visual ?? null);
  // A visual given to a layout with no place for one gets the layout that has it.
  if (visual && !layoutHasVisual(layout)) layout = "text-visual";
  slide.set("layout", layout);
  slide.set("hidden", input.hidden === true);
  const slots = new Y.Map<unknown>();
  slide.set("slots", slots);
  for (const name of textSlotNames) {
    const value = input[name];
    if (value === undefined && !textSlots(layout).some((slot) => slot.name === name)) continue;
    const fragment = new Y.XmlFragment();
    slots.set(name, fragment);
    if (value) writeRichText(fragment, markdownToRich(value));
  }
  if (visual) slots.set("visual", embedMap(visual));
  slide.set("notes", new Y.Text(typeof input.notes === "string" ? input.notes : ""));
}

function updateSlide(slide: Y.Map<unknown>, fields: SlideFields): void {
  const slots = ensureSlots(slide);
  const visual = fields.visual === undefined ? undefined : normalizeVisual(fields.visual);
  let layout = fields.layout ?? slideLayout(slide);
  if (fields.layout === undefined && visual && !layoutHasVisual(layout)) layout = "text-visual";
  if (layout !== slideLayout(slide)) switchLayout(slide, slots, layout);
  if (fields.hidden !== undefined) slide.set("hidden", fields.hidden);
  for (const name of textSlotNames) {
    const value = fields[name];
    if (value === undefined) continue;
    let fragment = slots.get(name);
    if (!(fragment instanceof Y.XmlFragment)) {
      fragment = new Y.XmlFragment();
      slots.set(name, fragment);
    }
    writeRichText(fragment as Y.XmlFragment, markdownToRich(value));
  }
  if (fields.visual === null) slots.delete("visual");
  else if (visual) slots.set("visual", embedMap(visual));
  if (fields.notes !== undefined) {
    const notes = slideNotes(slide);
    if (notes) {
      notes.delete(0, notes.length);
      notes.insert(0, fields.notes);
    } else slide.set("notes", new Y.Text(fields.notes));
  }
}

/**
 * Changes a slide's layout. Slots map by name, and an empty slot of the new layout takes the
 * content of a slot playing the same part that the new layout doesn't show (`slotAliases`).
 * Nothing is dropped: slots the new layout doesn't use stay, so switching back restores them.
 */
export function switchLayout(
  slide: Y.Map<unknown>,
  slots: Y.Map<unknown>,
  layout: SlideLayoutId,
): void {
  slide.set("layout", layout);
  const shown = new Set<string>(layoutSpec(layout).slots.map((slot) => slot.name));
  for (const spec of layoutSpec(layout).slots) {
    if (slotHasContent(slots.get(spec.name))) continue;
    const donor = (slotAliases[spec.name] ?? []).find(
      (alias) => !shown.has(alias) && slotHasContent(slots.get(alias)),
    );
    if (!donor) continue;
    const value = slots.get(donor);
    if (spec.kind === "text" && value instanceof Y.XmlFragment) {
      let target = slots.get(spec.name);
      if (!(target instanceof Y.XmlFragment)) {
        target = new Y.XmlFragment();
        slots.set(spec.name, target);
      }
      writeRichText(target as Y.XmlFragment, readRichText(value));
      slots.delete(donor);
    }
  }
  for (const spec of textSlots(layout)) {
    if (!(slots.get(spec.name) instanceof Y.XmlFragment)) slots.set(spec.name, new Y.XmlFragment());
  }
}

/** Switches a slide's layout from the editor. */
export function setSlideLayout(
  doc: Y.Doc,
  id: string,
  layout: SlideLayoutId,
  options: DeckWriteOptions = {},
): void {
  applyDeckOps(doc, [{ op: "update_slide", id, fields: { layout } }], options);
}

function ensureSlots(slide: Y.Map<unknown>): Y.Map<unknown> {
  const existing = slideSlots(slide);
  if (existing) return existing;
  const slots = new Y.Map<unknown>();
  slide.set("slots", slots);
  return slots;
}

function embedMap(embed: SlotEmbed): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(embed)) if (value !== undefined) map.set(key, value);
  return map;
}

function placeInOrder(parts: DeckParts, id: string, after: string | null): void {
  removeFromOrder(parts, id);
  const list = parts.order.toArray();
  const at = after === null ? 0 : list.indexOf(after) + 1;
  parts.order.insert(Math.max(0, Math.min(at, list.length)), [id]);
}

function removeFromOrder(parts: DeckParts, id: string): void {
  const list = parts.order.toArray();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index] === id) parts.order.delete(index, 1);
  }
}

function result(doc: Y.Doc, inserted: string[]): DeckOpsResult {
  const { slides } = deckParts(doc);
  return {
    slides: slideIdsInOrder(doc).map((id) => ({ id, layout: slideLayout(slides.get(id)!) })),
    inserted,
  };
}

export function newSlideId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `s${[...bytes]
    .map((value) => value.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12)}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export { isTextSlotName };
