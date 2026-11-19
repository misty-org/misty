import type * as Y from "yjs";
import { fitElement, type FitResult } from "./fit";
import { layoutSpec, type TextSlotSpec } from "./layouts";
import { readDeckSnapshot } from "./snapshot";
import { richTextIsEmpty, richToHtml } from "./richText";
import { applyStyle, slotInk, textBoxStyle, textContentStyle } from "./slotStyle";
import { loadThemeFonts } from "./themeFonts";
import { deckTheme, type DeckTheme } from "./themes";
import type { DeckLint, RichBlock } from "./types";

/**
 * What an agent (and the editor's rail) is told about a deck: text that overflows its slot even
 * at the smallest size, slots left empty, slots with more than six bullets, and visual layouts
 * with no visual. Works on a bare doc with no editor mounted; overflow is measured offscreen in
 * the theme's own fonts, which load first.
 */

export const MAX_BULLETS = 6;

/** Slots a layout may leave empty without it looking unfinished. */
const optionalSlots = new Set(["kicker", "subtitle", "caption", "attribution"]);

/** Whether text overflows a slot at its smallest size. Swappable for tests. */
export type SlotOverflowMeasure = (
  theme: DeckTheme,
  spec: TextSlotSpec,
  blocks: RichBlock[],
) => boolean;

export async function lintDeck(
  doc: Y.Doc,
  options: { measure?: SlotOverflowMeasure } = {},
): Promise<DeckLint[]> {
  const snapshot = readDeckSnapshot(doc);
  const theme = deckTheme(snapshot.theme);
  let measurer: OffscreenMeasurer | null = null;
  let measure = options.measure;
  if (!measure) {
    await loadThemeFonts(theme);
    measurer = createOffscreenMeasurer();
    measure = measurer.overflows;
  }
  const lints: DeckLint[] = [];
  try {
    for (const slide of snapshot.slides) {
      const layout = layoutSpec(slide.layout);
      for (const spec of layout.slots) {
        if (spec.kind === "visual") {
          if (!slide.visual)
            lints.push({
              slide_id: slide.id,
              slot: "visual",
              kind: "missing_image",
              message: `This ${layout.name} slide has no visual: add an image, chart or frame, or switch to a text layout.`,
            });
          continue;
        }
        const blocks = slide.texts[spec.name] ?? [];
        if (richTextIsEmpty(blocks)) {
          if (!optionalSlots.has(spec.name))
            lints.push({
              slide_id: slide.id,
              slot: spec.name,
              kind: "empty",
              message: `The ${spec.name} slot is empty.`,
            });
          continue;
        }
        const bullets = blocks.filter((block) => block.kind === "bullet").length;
        if (bullets > MAX_BULLETS)
          lints.push({
            slide_id: slide.id,
            slot: spec.name,
            kind: "crowded",
            message: `${bullets} bullets in ${spec.name}; keep it to ${MAX_BULLETS} or split the slide.`,
          });
        if (measure(theme, spec, blocks))
          lints.push({
            slide_id: slide.id,
            slot: spec.name,
            kind: "overflow",
            message: `The ${spec.name} text doesn't fit even at its smallest size (${spec.min}px); shorten it or split the slide.`,
          });
      }
    }
  } finally {
    measurer?.dispose();
  }
  return lints;
}

export interface OffscreenMeasurer {
  overflows: SlotOverflowMeasure;
  /** The size the slot's text fits at, stepping down from its largest, as the renderer does. */
  fit(theme: DeckTheme, spec: TextSlotSpec, blocks: RichBlock[]): FitResult;
  dispose(): void;
}

/** A hidden 1920×1080 frame off the screen where slots are laid out to be measured. */
export function createOffscreenMeasurer(): OffscreenMeasurer {
  const frame = document.createElement("div");
  applyStyle(frame, {
    position: "fixed",
    left: "-40000px",
    top: "0px",
    width: "1920px",
    height: "1080px",
    visibility: "hidden",
    pointerEvents: "none",
    contain: "strict",
  });
  frame.setAttribute("aria-hidden", "true");
  document.body.append(frame);
  const place = (theme: DeckTheme, spec: TextSlotSpec, blocks: RichBlock[], size: number) => {
    const box = document.createElement("div");
    applyStyle(box, textBoxStyle(spec));
    const content = document.createElement("div");
    applyStyle(content, textContentStyle(theme, spec, size));
    content.innerHTML = richToHtml(blocks, slotInk(theme, spec));
    box.append(content);
    frame.append(box);
    return { box, content };
  };
  return {
    fit(theme, spec, blocks) {
      const { box, content } = place(theme, spec, blocks, spec.max);
      const result = fitElement(content, box, spec.max, spec.min);
      box.remove();
      return result;
    },
    overflows(theme, spec, blocks) {
      const { box, content } = place(theme, spec, blocks, spec.min);
      const limit = box.clientHeight;
      const over = limit > 0 && content.offsetHeight > limit + 1;
      box.remove();
      return over;
    },
    dispose() {
      frame.remove();
    },
  };
}
