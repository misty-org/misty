import type { SlideLayoutId, SlotName, TextSlotName } from "./types";

/**
 * The nine layouts as data. A slide is a fixed 1920×1080 frame scaled to fit, so every box and
 * size here is in that frame's pixels: the editor, the thumbnails, present mode and both exports
 * read the same numbers.
 */

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

export interface SlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SlotColor = "text" | "soft" | "accent";
export type SlotFont = "heading" | "body";

export interface TextSlotSpec {
  name: TextSlotName;
  kind: "text";
  box: SlotBox;
  /** The largest and smallest font size, in frame pixels; the renderer steps between them. */
  max: number;
  min: number;
  font: SlotFont;
  weight: number;
  color: SlotColor;
  align: "start" | "center";
  valign: "start" | "center" | "end";
  lineHeight: number;
  /** Extra letter spacing, in em. */
  tracking?: number;
  /** Whether bullets belong here (body text); headings take paragraphs only. */
  bullets: boolean;
  /** What an empty slot says while editing. */
  placeholder: string;
}

export interface VisualSlotSpec {
  name: "visual";
  kind: "visual";
  box: SlotBox;
  /** Full bleed: no rounded corners, edge to edge. */
  bleed?: boolean;
}

export type SlotSpec = TextSlotSpec | VisualSlotSpec;

export interface LayoutSpec {
  id: SlideLayoutId;
  name: string;
  slots: SlotSpec[];
  /** The small deck title and slide number along the bottom. */
  footer: boolean;
}

const MX = 136;
const MY = 112;
const CW = SLIDE_WIDTH - MX * 2;

function text(
  name: TextSlotName,
  box: SlotBox,
  options: Partial<Omit<TextSlotSpec, "name" | "kind" | "box">> &
    Pick<TextSlotSpec, "max" | "min" | "placeholder">,
): TextSlotSpec {
  const heading = options.font === "heading";
  return {
    name,
    kind: "text",
    box,
    font: "body",
    weight: heading ? 600 : 400,
    color: "text",
    align: "start",
    valign: "start",
    lineHeight: heading ? 1.08 : 1.3,
    bullets: false,
    ...options,
  };
}

const heading = (box: SlotBox, max = 76, min = 44): TextSlotSpec =>
  text("title", box, { font: "heading", max, min, placeholder: "Title" });

const bodyText = (name: TextSlotName, box: SlotBox, max = 44, min = 26): TextSlotSpec =>
  text(name, box, { max, min, bullets: true, placeholder: name === "right" ? "More" : "Body" });

export const slideLayouts: Record<SlideLayoutId, LayoutSpec> = {
  title: {
    id: "title",
    name: "Title",
    footer: true,
    slots: [
      text(
        "kicker",
        { x: MX, y: 288, w: CW, h: 72 },
        {
          max: 30,
          min: 22,
          color: "accent",
          weight: 600,
          tracking: 0.12,
          valign: "end",
          placeholder: "Kicker",
        },
      ),
      text(
        "title",
        { x: MX, y: 372, w: CW, h: 336 },
        {
          font: "heading",
          max: 128,
          min: 64,
          valign: "end",
          lineHeight: 1.02,
          placeholder: "Title",
        },
      ),
      text(
        "subtitle",
        { x: MX, y: 732, w: CW, h: 176 },
        { max: 40, min: 26, color: "soft", placeholder: "Subtitle" },
      ),
    ],
  },
  section: {
    id: "section",
    name: "Section",
    footer: true,
    slots: [
      text(
        "title",
        { x: MX, y: 240, w: CW, h: 600 },
        {
          font: "heading",
          max: 120,
          min: 60,
          align: "center",
          valign: "center",
          lineHeight: 1.04,
          placeholder: "Section title",
        },
      ),
    ],
  },
  bullets: {
    id: "bullets",
    name: "Bullets",
    footer: true,
    slots: [
      heading({ x: MX, y: MY, w: CW, h: 168 }),
      bodyText("body", { x: MX, y: 316, w: CW, h: 652 }),
    ],
  },
  "two-columns": {
    id: "two-columns",
    name: "Two columns",
    footer: true,
    slots: [
      heading({ x: MX, y: MY, w: CW, h: 168 }),
      bodyText("left", { x: MX, y: 316, w: 784, h: 652 }, 40),
      bodyText("right", { x: MX + 864, y: 316, w: 784, h: 652 }, 40),
    ],
  },
  "text-visual": {
    id: "text-visual",
    name: "Text + visual",
    footer: true,
    slots: [
      heading({ x: MX, y: MY, w: 760, h: 232 }, 68, 40),
      bodyText("body", { x: MX, y: 376, w: 760, h: 592 }, 38),
      { name: "visual", kind: "visual", box: { x: 976, y: MY, w: 808, h: 856 } },
    ],
  },
  "visual-text": {
    id: "visual-text",
    name: "Visual + text",
    footer: true,
    slots: [
      { name: "visual", kind: "visual", box: { x: MX, y: MY, w: 808, h: 856 } },
      heading({ x: 1024, y: MY, w: 760, h: 232 }, 68, 40),
      bodyText("body", { x: 1024, y: 376, w: 760, h: 592 }, 38),
    ],
  },
  "full-visual": {
    id: "full-visual",
    name: "Full visual",
    footer: false,
    slots: [
      { name: "visual", kind: "visual", box: { x: 0, y: 0, w: SLIDE_WIDTH, h: 944 }, bleed: true },
      text(
        "caption",
        { x: MX, y: 960, w: CW, h: 96 },
        { max: 32, min: 22, color: "soft", valign: "center", placeholder: "Caption" },
      ),
    ],
  },
  "big-number": {
    id: "big-number",
    name: "Big number",
    footer: true,
    slots: [
      text(
        "number",
        { x: MX, y: 200, w: CW, h: 440 },
        {
          font: "heading",
          max: 300,
          min: 140,
          color: "accent",
          valign: "end",
          lineHeight: 0.92,
          placeholder: "3×",
        },
      ),
      text(
        "label",
        { x: MX, y: 688, w: CW, h: 220 },
        { max: 52, min: 32, placeholder: "What the number means" },
      ),
    ],
  },
  quote: {
    id: "quote",
    name: "Quote",
    footer: true,
    slots: [
      text(
        "quote",
        { x: MX, y: 168, w: CW, h: 592 },
        {
          font: "heading",
          max: 84,
          min: 44,
          weight: 500,
          valign: "end",
          lineHeight: 1.2,
          placeholder: "Quote",
        },
      ),
      text(
        "attribution",
        { x: MX, y: 792, w: CW, h: 112 },
        { max: 36, min: 26, color: "soft", placeholder: "Who said it" },
      ),
    ],
  },
};

/** The footer's line along the bottom of a slide, in frame pixels. */
export const footerBox: SlotBox = { x: MX, y: 1004, w: CW, h: 40 };
export const footerFontSize = 22;

export function layoutSpec(layout: SlideLayoutId): LayoutSpec {
  return slideLayouts[layout] ?? slideLayouts.bullets;
}

export function layoutSlot(layout: SlideLayoutId, name: SlotName): SlotSpec | undefined {
  return layoutSpec(layout).slots.find((slot) => slot.name === name);
}

export function layoutHasVisual(layout: SlideLayoutId): boolean {
  return layoutSpec(layout).slots.some((slot) => slot.kind === "visual");
}

export function textSlots(layout: SlideLayoutId): TextSlotSpec[] {
  return layoutSpec(layout).slots.filter((slot): slot is TextSlotSpec => slot.kind === "text");
}

/**
 * Slots that play the same part on another layout. Switching layout fills an empty slot from a
 * slot of the same part that the new layout doesn't show (bullets' body becomes the left
 * column), so switching back puts it where it was. Everything else keeps its own name.
 */
export const slotAliases: Partial<Record<SlotName, SlotName[]>> = {
  body: ["left"],
  left: ["body"],
  subtitle: ["label", "caption", "attribution"],
  label: ["subtitle", "caption", "attribution"],
  caption: ["subtitle", "label", "attribution"],
  attribution: ["subtitle", "label", "caption"],
};
