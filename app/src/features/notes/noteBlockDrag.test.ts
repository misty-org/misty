import { afterEach, describe, expect, it } from "vitest";
import { noteBlockTargetAt } from "./components/NoteBlockEditor";

function addBlock(root: HTMLElement, id: string, top: number, bottom: number) {
  const block = document.createElement("div");
  block.className = "bn-block-outer";
  block.dataset.id = id;
  block.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      bottom,
      left: 0,
      right: 600,
      width: 600,
      height: bottom - top,
      toJSON: () => ({}),
    }) as DOMRect;
  root.append(block);
  return block;
}

describe("noteBlockTargetAt", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("skips the source and chooses the nearest live block geometrically", () => {
    const root = document.createElement("div");
    document.body.append(root);
    addBlock(root, "first", 10, 30);
    addBlock(root, "source", 40, 60);
    addBlock(root, "third", 70, 90);

    expect(noteBlockTargetAt(root, "source", 24)).toMatchObject({
      blockId: "first",
      placement: "after",
    });
    expect(noteBlockTargetAt(root, "source", 73)).toMatchObject({
      blockId: "third",
      placement: "before",
    });
  });

  it("still finds the nearest target between and beyond blocks", () => {
    const root = document.createElement("div");
    document.body.append(root);
    addBlock(root, "first", 20, 40);
    addBlock(root, "second", 80, 100);

    expect(noteBlockTargetAt(root, "none", 60)).toMatchObject({
      blockId: "first",
      placement: "after",
    });
    expect(noteBlockTargetAt(root, "none", 120)).toMatchObject({
      blockId: "second",
      placement: "after",
    });
  });
});
