/**
 * A live embed: one part of another Space item shown inside a doc or a deck. Nothing of the
 * source is copied into the host; only this reference (and the last title seen, for the
 * Private and Removed states) is stored.
 */
export type EmbedKind = "data-chart" | "data-range" | "board-frame";

export const embedKinds: readonly EmbedKind[] = ["data-chart", "data-range", "board-frame"];

export interface EmbedReference {
  kind: EmbedKind;
  /** The source item: a workbook for Data parts, a drawing for a Whiteboard frame. */
  item_id: string;
  /**
   * The part inside it: a Data chart's chart id, a Data range as `<sheetId>!<anchored range>`,
   * or a Whiteboard frame's Excalidraw element id.
   */
  part_id: string;
  /** The last title seen, shown when the source can no longer be read. */
  title?: string;
}

/** The kind of item an embed's source is, as the server and the visibility route name it. */
export type EmbedSourceKind = "workbook" | "drawing";

export function isEmbedKind(value: unknown): value is EmbedKind {
  return typeof value === "string" && (embedKinds as readonly string[]).includes(value);
}

export function embedSourceKind(kind: EmbedKind): EmbedSourceKind {
  return kind === "board-frame" ? "drawing" : "workbook";
}

export function isEmbedReference(value: unknown): value is EmbedReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isEmbedKind(candidate.kind) &&
    typeof candidate.item_id === "string" &&
    candidate.item_id.length > 0 &&
    typeof candidate.part_id === "string" &&
    candidate.part_id.length > 0 &&
    (candidate.title === undefined || typeof candidate.title === "string")
  );
}

/** One key per source part, for de-duplicating the embeds a host holds. */
export function embedKey(embed: Pick<EmbedReference, "kind" | "item_id" | "part_id">): string {
  return `${embed.kind}:${embed.item_id}:${embed.part_id}`;
}
