import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it, vi } from "vitest";
import { figmaImportKey, toFigmaCanvasReference } from "./figmaCanvasReference";
import { buildFigmaReferenceElements, hasFigmaReference } from "./figmaCanvasElements";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: OrderedExcalidrawElement[]) =>
    elements.map((element, index) => ({
      ...element,
      id: element.id ?? `element-${index}`,
    })),
}));

describe("Figma canvas references", () => {
  it("builds a bounded native card with source provenance and stable idempotency", () => {
    const reference = toFigmaCanvasReference(
      "binding-1",
      {
        file: {
          key: "Abc_def-123",
          name: "Launch system",
          version: "42",
          last_modified: "2026-08-19T00:00:00Z",
          editor_type: "figma",
          thumbnail_url: "https://images.figma.com/preview.png",
        },
        versions: [],
        comments: [],
      },
      "https://www.figma.com/file/Abc_def-123",
    );
    const first = buildFigmaReferenceElements(reference, 10, 20);
    const second = buildFigmaReferenceElements(reference, 200, 300);

    expect(first).toHaveLength(6);
    expect(first.map((element) => element.id)).toEqual(second.map((element) => element.id));
    expect(first[0].width).toBeLessThanOrEqual(440);
    expect(first[0].height).toBeLessThanOrEqual(230);
    expect(first[0].customData?.figma.thumbnailUrl).toBe("https://images.figma.com/preview.png");
    expect(figmaImportKey(reference)).toBe("binding-1:Abc_def-123:42");
    expect(hasFigmaReference(first as OrderedExcalidrawElement[], reference)).toBe(true);
  });

  it("drops unsafe thumbnail URLs instead of putting them on the canvas", () => {
    const reference = toFigmaCanvasReference(
      "binding-1",
      {
        file: {
          key: "Abc_def-123",
          name: "Launch",
          version: "1",
          last_modified: "",
          editor_type: "figma",
          thumbnail_url: "javascript:alert(1)",
        },
        versions: [],
        comments: [],
      },
      "https://www.figma.com/file/Abc_def-123",
    );

    expect(reference.thumbnailUrl).toBe("");
  });
});
