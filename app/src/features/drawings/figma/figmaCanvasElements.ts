import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { figmaImportKey, type FigmaCanvasReference } from "./figmaCanvasReference";

export function buildFigmaReferenceElements(
  reference: FigmaCanvasReference,
  x: number,
  y: number,
): OrderedExcalidrawElement[] {
  const importKey = figmaImportKey(reference);
  const token = stableToken(importKey);
  const common = {
    groupIds: [`misty-figma-${token}`],
    customData: { mistyFigmaImportKey: importKey, figma: reference },
  };
  return convertToExcalidrawElements(
    [
      {
        id: `misty-figma-${token}-card`,
        type: "rectangle",
        x,
        y,
        width: 440,
        height: 230,
        backgroundColor: "#f3f0ff",
        strokeColor: "#7651c9",
        fillStyle: "solid",
        roundness: { type: 3 },
        link: reference.sourceUrl,
        ...common,
      },
      {
        id: `misty-figma-${token}-preview`,
        type: "rectangle",
        x: x + 20,
        y: y + 55,
        width: 120,
        height: 118,
        backgroundColor: "#ddd6fe",
        strokeColor: "#8b5cf6",
        fillStyle: "solid",
        roundness: { type: 3 },
        link: reference.thumbnailUrl || reference.sourceUrl,
        ...common,
      },
      {
        id: `misty-figma-${token}-preview-label`,
        type: "text",
        x: x + 38,
        y: y + 93,
        width: 84,
        text: reference.thumbnailUrl ? "FIGMA\nPREVIEW" : "FIGMA\nFILE",
        fontSize: 18,
        textAlign: "center",
        strokeColor: "#5b21b6",
        link: reference.thumbnailUrl || reference.sourceUrl,
        ...common,
      },
      {
        id: `misty-figma-${token}-title`,
        type: "text",
        x: x + 20,
        y: y + 18,
        width: 395,
        text: reference.title,
        fontSize: 22,
        strokeColor: "#2e1065",
        link: reference.sourceUrl,
        ...common,
      },
      {
        id: `misty-figma-${token}-details`,
        type: "text",
        x: x + 160,
        y: y + 67,
        width: 250,
        text: `Version ${reference.version}\nSource: Figma\nFile: ${reference.fileKey}\n\nOpen source ↗`,
        fontSize: 16,
        strokeColor: "#3b2770",
        link: reference.sourceUrl,
        ...common,
      },
      {
        id: `misty-figma-${token}-provenance`,
        type: "text",
        x: x + 20,
        y: y + 194,
        width: 390,
        text: "Imported as a read-only Figma reference · Native Misty canvas",
        fontSize: 12,
        strokeColor: "#6d5b98",
        ...common,
      },
    ],
    { regenerateIds: false },
  );
}

export function hasFigmaReference(
  elements: readonly OrderedExcalidrawElement[],
  reference: FigmaCanvasReference,
): boolean {
  const key = figmaImportKey(reference);
  return elements.some((element) => element.customData?.mistyFigmaImportKey === key);
}

function stableToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
