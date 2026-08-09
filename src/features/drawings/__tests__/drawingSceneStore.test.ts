import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDrawingElements, writeDrawingElements } from "../collaboration/drawingSceneStore";

describe("drawingSceneStore", () => {
  it("stores elements independently and restores fractional order", () => {
    const doc = new Y.Doc();
    const elements = doc.getMap<OrderedExcalidrawElement>("elements");

    expect(
      writeDrawingElements(elements, [
        element("second", "b1", 1, 20),
        element("first", "a1", 1, 10),
      ]),
    ).toBe(2);
    expect(readDrawingElements(elements).map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("keeps newer versions and uses Excalidraw's lowest-nonce tie break", () => {
    const doc = new Y.Doc();
    const elements = doc.getMap<OrderedExcalidrawElement>("elements");
    writeDrawingElements(elements, [element("shape", "a1", 4, 50)]);

    expect(writeDrawingElements(elements, [element("shape", "a1", 3, 1)])).toBe(0);
    expect(elements.get("shape")?.versionNonce).toBe(50);

    expect(writeDrawingElements(elements, [element("shape", "a1", 4, 10)])).toBe(1);
    expect(elements.get("shape")?.versionNonce).toBe(10);
  });
});

function element(
  id: string,
  index: string,
  version: number,
  versionNonce: number,
): OrderedExcalidrawElement {
  return {
    id,
    index,
    version,
    versionNonce,
    isDeleted: false,
  } as unknown as OrderedExcalidrawElement;
}
