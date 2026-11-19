import type { ReactNode } from "react";
import type { MarkKind } from "./imageEdit";
import type { ImageCollaboration } from "./imagePresence";
import { markColors, strokeSizes, textSizes } from "./imageEdit";

/**
 * What the image is open for: looking at it, marking it up (the second toolbar row), or
 * cropping it with a box dragged over the whole image.
 */
export type EditorMode = "view" | "markup" | "crop";

/**
 * Picking and moving marks, or drawing one kind of mark. Stickers aren't drawn: they are placed
 * from the Stickers tab.
 */
export type MarkupTool = "select" | Exclude<MarkKind, "sticker">;

/** What a sticker dragged from the Stickers tab carries: its id. */
export const stickerDragType = "application/x-misty-sticker";

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

/** The single keys that pick each markup tool; T opens the Text tab. */
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

export interface PhotoEditorProps {
  /** Remounts the editor when the underlying image changes. */
  sourceKey: string;
  /** File/display name, shown in the bar and used to name what is saved. */
  name: string;
  /** Object URL (blob:/asset:) for the image to show and edit. */
  url: string;
  /** Where it sits among its neighbors, such as "3 of 12". */
  indexLabel?: string;
  tags?: string[];
  /** Preferred output MIME type; defaults to image/png. */
  outputMimeType?: string;
  loading?: boolean;
  error?: string;
  /** When true, the editor only shows the image. */
  readonly?: boolean;
  /** The original's size in pixels, when `url` is a smaller preview of it. */
  naturalSize?: { width: number; height: number };
  /**
   * The full-size image to save from, when `url` is a smaller preview. Without it, or if it
   * can't be read, the edit is saved from `url`.
   */
  loadOriginal?: () => Promise<Blob>;
  onClose: () => void;
  onCancel?: () => void;
  /** The image before and after this one among its neighbors, when there are any. */
  onPrevious?: () => void;
  onNext?: () => void;
  /**
   * Saves over the original. Left out where that isn't possible: "Save" then saves a copy. It
   * returns the version the original now is, which a shared edit starts again from.
   */
  onSave?: (rendered: Blob) => void | string | Promise<void | string>;
  /** Saves the edited image as a new copy, under `filename` when one is chosen. */
  onSaveAsCopy: (rendered: Blob, filename?: string) => void | Promise<void>;
  /** The edit shared live with others. Without it, the edit belongs to this window alone. */
  collaboration?: ImageCollaboration | null;
  /** The Agent tab's chat about this image, where the person's agent can reach it. */
  agentPanel?: ReactNode;
}
