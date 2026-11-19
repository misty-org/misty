import * as Y from "yjs";
import {
  deckParts,
  readDeckTheme,
  readDeckTitle,
  readEmbed,
  slideIdsInOrder,
  slideLayout,
  slideNotes,
  slideSlots,
} from "./model";
import { readRichText } from "./richText";
import {
  isTextSlotName,
  type DeckThemeId,
  type RichBlock,
  type SlideLayoutId,
  type SlotEmbed,
  type TextSlotName,
} from "./types";

/** One slide as the renderer draws it: plain data, so a thumbnail redraws only when it changes. */
export interface SlideSnapshot {
  id: string;
  layout: SlideLayoutId;
  hidden: boolean;
  texts: Partial<Record<TextSlotName, RichBlock[]>>;
  visual: SlotEmbed | null;
  notes: string;
}

export interface DeckSnapshot {
  title: string;
  theme: DeckThemeId;
  slides: SlideSnapshot[];
}

export function readSlideSnapshot(id: string, slide: Y.Map<unknown>): SlideSnapshot {
  const texts: SlideSnapshot["texts"] = {};
  let visual: SlotEmbed | null = null;
  slideSlots(slide)?.forEach((value, name) => {
    if (value instanceof Y.XmlFragment && isTextSlotName(name)) texts[name] = readRichText(value);
    else if (name === "visual") visual = readEmbed(value);
  });
  return {
    id,
    layout: slideLayout(slide),
    hidden: slide.get("hidden") === true,
    texts,
    visual,
    notes: slideNotes(slide)?.toString() ?? "",
  };
}

export function readDeckSnapshot(doc: Y.Doc): DeckSnapshot {
  const { slides } = deckParts(doc);
  return {
    title: readDeckTitle(doc),
    theme: readDeckTheme(doc),
    slides: slideIdsInOrder(doc).map((id) => readSlideSnapshot(id, slides.get(id)!)),
  };
}

/**
 * Keeps a deck snapshot current as the room changes, rereading only the slides a change
 * touched, so typing on one slide doesn't rebuild every thumbnail.
 */
export function watchDeckSnapshot(doc: Y.Doc, onChange: (snapshot: DeckSnapshot) => void) {
  const parts = deckParts(doc);
  const cache = new Map<string, SlideSnapshot>();
  let snapshot = build();

  function build(): DeckSnapshot {
    const ids = slideIdsInOrder(doc);
    const slides = ids.map((id) => {
      let entry = cache.get(id);
      if (!entry) {
        entry = readSlideSnapshot(id, parts.slides.get(id)!);
        cache.set(id, entry);
      }
      return entry;
    });
    for (const id of [...cache.keys()]) if (!ids.includes(id)) cache.delete(id);
    return { title: readDeckTitle(doc), theme: readDeckTheme(doc), slides };
  }

  const onSlides = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const event of events) {
      if (event.target === parts.slides) {
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) cache.delete(key);
      } else {
        const id = event.path[0];
        if (typeof id === "string") cache.delete(id);
      }
    }
    snapshot = build();
    onChange(snapshot);
  };
  const onOther = () => {
    snapshot = build();
    onChange(snapshot);
  };
  parts.slides.observeDeep(onSlides);
  parts.order.observe(onOther);
  parts.meta.observe(onOther);
  return {
    current: () => snapshot,
    stop: () => {
      parts.slides.unobserveDeep(onSlides);
      parts.order.unobserve(onOther);
      parts.meta.unobserve(onOther);
    },
  };
}
