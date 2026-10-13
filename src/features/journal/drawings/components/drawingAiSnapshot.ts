import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { DrawingAiSnapshot } from "./collaborativeDrawingCanvasTypes";

export function drawingAiSnapshot(
  elements: readonly OrderedExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
): DrawingAiSnapshot {
  const visible = elements.filter((element) => !element.isDeleted);
  const selected = visible.filter((element) => selectedElementIds[element.id]);
  const relevant = (selected.length ? selected : visible).slice(0, 160);
  const content = JSON.stringify({
    scope: selected.length ? "selection" : "visible_scene",
    truncated: relevant.length < (selected.length ? selected.length : visible.length),
    elements: relevant.map((element) => ({
      id: element.id,
      type: element.type,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
      angle: Math.round(element.angle * 1000) / 1000,
      text:
        "text" in element && typeof element.text === "string"
          ? element.text.slice(0, 1000)
          : undefined,
      link: typeof element.link === "string" ? element.link.slice(0, 1000) : undefined,
      group_ids: element.groupIds.slice(0, 20),
      bound_to:
        "boundElements" in element && Array.isArray(element.boundElements)
          ? element.boundElements.slice(0, 20).map((bound) => bound.id)
          : undefined,
    })),
  }).slice(0, 32 << 10);
  return {
    content,
    contentHash: drawingAiHash(content),
    selectedCount: selected.length,
    elementCount: visible.length,
  };
}

function drawingAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
