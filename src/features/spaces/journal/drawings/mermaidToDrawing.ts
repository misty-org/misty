import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { drawingsApi } from "./api/api";
import type { DrawingSceneResult } from "./api/drawingApiTypes";

/*
 * `drawing.from_mermaid` (plan W2): a Mermaid diagram becomes editable Excalidraw shapes on a
 * whiteboard. The diagram is converted here, in the tool host's webview (Mermaid lays it out in
 * the DOM), and goes in through the same scene route `drawing.apply` writes, below what the
 * board already holds.
 */

/** The most elements the room takes in one scene change. */
const maxElementsPerApply = 500;
/** The space left between the board's content and the diagram placed under it. */
const placementGap = 80;

export class MermaidDiagramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MermaidDiagramError";
  }
}

type SceneElement = Record<string, unknown> & {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
};

function bounds(elements: readonly SceneElement[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    if (element.isDeleted) continue;
    const x = Number(element.x);
    const y = Number(element.y);
    const height = Number(element.height ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + (Number.isFinite(height) ? height : 0));
  }
  return Number.isFinite(minX) ? { minX, minY, maxY } : null;
}

/** Converts Mermaid source to Excalidraw elements, refusing diagrams that only draw as a picture. */
export async function mermaidToElements(mermaid: string): Promise<ExcalidrawElement[]> {
  const source = mermaid.trim();
  if (!source) throw new MermaidDiagramError("The Mermaid diagram is empty.");
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  let result: Awaited<ReturnType<typeof parseMermaidToExcalidraw>>;
  try {
    result = await parseMermaidToExcalidraw(source, { themeVariables: { fontSize: "20px" } });
  } catch (error) {
    throw new MermaidDiagramError(
      `The Mermaid diagram couldn't be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.files && Object.keys(result.files).length > 0) {
    throw new MermaidDiagramError(
      "This kind of Mermaid diagram only draws as a picture. Use a flowchart, a sequence diagram or a class diagram.",
    );
  }
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  return convertToExcalidrawElements(
    result.elements as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: true },
  ) as ExcalidrawElement[];
}

/** Moves elements so the diagram's top left sits at `at`. */
export function placeElements<T extends SceneElement>(
  elements: readonly T[],
  at: { x: number; y: number },
): T[] {
  const own = bounds(elements);
  if (!own) return [...elements];
  const dx = at.x - own.minX;
  const dy = at.y - own.minY;
  return elements.map((element) => ({
    ...element,
    x: Number(element.x) + dx,
    y: Number(element.y) + dy,
  }));
}

/**
 * Draws a Mermaid diagram onto a whiteboard as editable shapes, under its current content.
 * Returns the room's answer to the last change plus how many elements were added.
 */
export async function mermaidToDrawing(
  spaceId: string,
  drawingId: string,
  mermaid: string,
  options?: { idempotencyKey?: string },
): Promise<DrawingSceneResult & { element_count: number; added: number }> {
  const converted = (await mermaidToElements(mermaid)) as unknown as SceneElement[];
  if (!converted.length) throw new MermaidDiagramError("The Mermaid diagram has nothing to draw.");
  const current = await drawingsApi.readScene(spaceId, drawingId);
  const existing = bounds(current.elements as SceneElement[]);
  const elements = existing
    ? placeElements(converted, { x: existing.minX, y: existing.maxY + placementGap })
    : converted;
  let baseHash = current.content_hash;
  let result: DrawingSceneResult | null = null;
  for (let start = 0; start < elements.length; start += maxElementsPerApply) {
    const chunk = elements.slice(start, start + maxElementsPerApply);
    const key = options?.idempotencyKey
      ? `${options.idempotencyKey}:${start / maxElementsPerApply}`
      : undefined;
    result = await drawingsApi.applyScene(
      spaceId,
      drawingId,
      { base_hash: baseHash, mode: "merge", elements: chunk },
      key,
    );
    baseHash = result.content_hash;
  }
  return { ...result!, added: elements.length, element_count: result!.element_count };
}
