import type { MarkKind } from "./imageEdit";
import { markColors, strokeSizes, textSizes } from "./imageEdit";

/**
 * What the image is open for: looking at it, marking it up (the second toolbar row), or
 * cropping it with a box dragged over the whole image.
 */
export type EditorMode = "view" | "markup" | "crop";

/** Picking and moving marks, or drawing one kind of mark. */
export type MarkupTool = "select" | MarkKind;

/** How new marks are drawn, and what the style controls show. */
export interface MarkStyle {
  color: string;
  /** Stroke width, in fractions of the image's longer side. */
  stroke: number;
  /** Text size, in fractions of the image's longer side. */
  text: number;
  /** Rectangles and ellipses filled rather than outlined. */
  fill: boolean;
}

export const defaultMarkStyle: MarkStyle = {
  color: markColors[0].value,
  stroke: strokeSizes[1].value,
  text: textSizes[1].value,
  fill: false,
};

/** The single keys that pick each markup tool. */
export const markupToolKeys: Record<MarkupTool, string> = {
  select: "V",
  pen: "P",
  line: "L",
  arrow: "A",
  rect: "R",
  ellipse: "O",
  text: "T",
  redact: "B",
};

/** A text mark being written: where it goes, and the mark it replaces when it is one already. */
export interface TextDraft {
  at: { x: number; y: number };
  markId?: string;
  text: string;
}
