import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { lintDeck, type SlotOverflowMeasure } from "./lint";
import { createDeck, slideIdsInOrder } from "./model";

const fits: SlotOverflowMeasure = () => false;

describe("lintDeck", () => {
  it("passes a finished deck", async () => {
    const doc = new Y.Doc();
    createDeck(doc, {
      slides: [
        { layout: "title", title: "Launch review" },
        { layout: "bullets", title: "Shipped", body: "- One\n- Two" },
        { layout: "text-visual", title: "Growth", body: "Up", visual: { image_asset_id: "a1" } },
      ],
    });
    expect(await lintDeck(doc, { measure: fits })).toEqual([]);
  });

  it("finds empty slots but not optional ones", async () => {
    const doc = new Y.Doc();
    createDeck(doc, {
      slides: [{ layout: "title" }, { layout: "bullets", title: "Only a title" }],
    });
    const [first, second] = slideIdsInOrder(doc);
    const lints = await lintDeck(doc, { measure: fits });
    expect(lints).toEqual([
      expect.objectContaining({ slide_id: first, slot: "title", kind: "empty" }),
      expect.objectContaining({ slide_id: second, slot: "body", kind: "empty" }),
    ]);
  });

  it("flags more than six bullets as crowded", async () => {
    const doc = new Y.Doc();
    const body = Array.from({ length: 7 }, (_, index) => `- Point ${index + 1}`).join("\n");
    createDeck(doc, { slides: [{ layout: "bullets", title: "Too much", body }] });
    const lints = await lintDeck(doc, { measure: fits });
    expect(lints).toEqual([expect.objectContaining({ slot: "body", kind: "crowded" })]);
  });

  it("flags visual layouts without a visual", async () => {
    const doc = new Y.Doc();
    createDeck(doc, { slides: [{ layout: "full-visual", caption: "A view" }] });
    const lints = await lintDeck(doc, { measure: fits });
    expect(lints).toEqual([expect.objectContaining({ slot: "visual", kind: "missing_image" })]);
  });

  it("reports text that overflows at its smallest size, measured per slot", async () => {
    const doc = new Y.Doc();
    createDeck(doc, { slides: [{ layout: "bullets", title: "Fine", body: "A very long body" }] });
    const measure = vi.fn<SlotOverflowMeasure>((_theme, spec) => spec.name === "body");
    const lints = await lintDeck(doc, { measure });
    expect(lints).toEqual([expect.objectContaining({ slot: "body", kind: "overflow" })]);
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "misty" }),
      expect.objectContaining({ name: "body", min: 26 }),
      expect.any(Array),
    );
  });

  it("measures offscreen on a bare doc with no editor mounted", async () => {
    const doc = new Y.Doc();
    createDeck(doc, { slides: [{ layout: "section", title: "Part two" }] });
    // jsdom lays nothing out, so nothing measures as overflowing; the frame is cleaned up.
    await expect(lintDeck(doc)).resolves.toEqual([]);
    expect(document.body.querySelector("[aria-hidden='true']")).toBeNull();
  });
});
