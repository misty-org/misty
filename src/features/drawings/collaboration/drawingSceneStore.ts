import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type * as Y from "yjs";

export const localDrawingOrigin = Symbol("misty-drawing-local");

type StoredElement = OrderedExcalidrawElement;

function cloneElement(element: OrderedExcalidrawElement): StoredElement {
  return JSON.parse(JSON.stringify(element)) as StoredElement;
}

function isNewerElement(
  next: OrderedExcalidrawElement,
  current: StoredElement | undefined,
): boolean {
  if (!current) return true;
  if (next.version !== current.version) return next.version > current.version;
  // Mirrors Excalidraw's conflict rule: equal-version edits converge on the
  // lowest nonce.
  return next.versionNonce < current.versionNonce;
}

// Excalidraw's fractional indices are lexically sortable. ID is a stable
// tiebreaker for old scenes whose elements do not yet carry an index.
function compareElementOrder(left: StoredElement, right: StoredElement): number {
  const leftIndex = "index" in left ? String(left.index ?? "") : "";
  const rightIndex = "index" in right ? String(right.index ?? "") : "";
  return leftIndex.localeCompare(rightIndex) || left.id.localeCompare(right.id);
}

export function readDrawingElements(elements: Y.Map<StoredElement>): OrderedExcalidrawElement[] {
  return Array.from(elements.values()).sort(compareElementOrder);
}

export function writeDrawingElements(
  elements: Y.Map<StoredElement>,
  nextElements: readonly OrderedExcalidrawElement[],
): number {
  const document = elements.doc;
  if (!document) return 0;
  let changed = 0;
  document.transact(() => {
    for (const element of nextElements) {
      const current = elements.get(element.id);
      if (!isNewerElement(element, current)) continue;
      elements.set(element.id, cloneElement(element));
      changed += 1;
    }
  }, localDrawingOrigin);
  return changed;
}
