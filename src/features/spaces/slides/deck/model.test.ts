import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyDeckOps,
  createDeck,
  DeckOpError,
  deckParts,
  duplicateSlide,
  readDeckOutline,
  slideIdsInOrder,
  slideSlots,
} from "./model";
import { markdownToRich, readRichText, richToMarkdown } from "./richText";

function deck() {
  const doc = new Y.Doc();
  const created = createDeck(doc, {
    title: "Launch review",
    theme: "paper",
    slides: [
      { layout: "title", kicker: "Q4", title: "Launch review", subtitle: "What shipped" },
      {
        layout: "bullets",
        title: "What shipped",
        body: "- Docs\n- Slides\n  - Themes\n- Data",
        notes: "Keep it short",
      },
      { layout: "big-number", number: "3×", label: "weekly active Spaces" },
    ],
  });
  return { doc, ids: created.inserted };
}

describe("createDeck", () => {
  it("writes the contract's keys and reads back as an outline", () => {
    const { doc, ids } = deck();
    expect(doc.getMap("deck:meta").get("theme")).toBe("paper");
    expect(doc.getMap("deck:meta").get("title")).toBe("Launch review");
    expect(doc.getArray("deck:order").toArray()).toEqual(ids);
    const outline = readDeckOutline(doc);
    expect(outline.theme).toBe("paper");
    expect(outline.slides.map((slide) => slide.layout)).toEqual(["title", "bullets", "big-number"]);
    expect(outline.slides[1].slots.body).toBe("- Docs\n- Slides\n  - Themes\n- Data");
    expect(outline.slides[1].notes).toBe("Keep it short");
    expect(outline.slides[2].slots.number).toBe("3×");
  });

  it("stores text slots as Tiptap fragments and notes as text", () => {
    const { doc, ids } = deck();
    const slide = deckParts(doc).slides.get(ids[1])!;
    const body = slideSlots(slide)!.get("body");
    expect(body).toBeInstanceOf(Y.XmlFragment);
    const list = (body as Y.XmlFragment).get(0) as Y.XmlElement;
    expect(list.nodeName).toBe("bulletList");
    expect((list.get(0) as Y.XmlElement).nodeName).toBe("listItem");
    expect(slide.get("notes")).toBeInstanceOf(Y.Text);
  });

  it("maps agent visuals onto embed maps", () => {
    const doc = new Y.Doc();
    createDeck(doc, {
      slides: [
        {
          layout: "text-visual",
          title: "Growth",
          visual: { data_chart: { item_id: "wb1", part_id: "c1", title: "Weekly" } },
        },
        { layout: "full-visual", visual: { image_asset_id: "asset-1" } },
      ],
    });
    const outline = readDeckOutline(doc);
    expect(outline.slides[0].slots.visual).toEqual({
      type: "data-chart",
      item_id: "wb1",
      part_id: "c1",
      title: "Weekly",
    });
    expect(outline.slides[1].slots.visual).toEqual({ type: "image", asset_id: "asset-1" });
  });

  it("refuses an unknown layout without writing anything", () => {
    const doc = new Y.Doc();
    expect(() => createDeck(doc, { slides: [{ layout: "grid" as never }] })).toThrow(DeckOpError);
    expect(doc.getArray("deck:order").length).toBe(0);
  });
});

describe("applyDeckOps", () => {
  it("inserts first when after is left out, and after a slide when given", () => {
    const { doc, ids } = deck();
    const result = applyDeckOps(doc, [
      { op: "insert_slide", slide: { layout: "section", title: "Intro" } },
      { op: "insert_slide", after: ids[0], slide: { layout: "quote", quote: "Ship it" } },
    ]);
    expect(result.inserted).toHaveLength(2);
    expect(result.slides.map((slide) => slide.id)).toEqual([
      result.inserted[0],
      ids[0],
      result.inserted[1],
      ids[1],
      ids[2],
    ]);
  });

  it("moves, deletes and sets the theme in one transaction", () => {
    const { doc, ids } = deck();
    let transactions = 0;
    doc.on("afterTransaction", () => (transactions += 1));
    applyDeckOps(doc, [
      { op: "move_slide", id: ids[2], after: ids[0] },
      { op: "delete_slide", id: ids[1] },
      { op: "set_theme", theme: "ink" },
    ]);
    expect(transactions).toBe(1);
    expect(slideIdsInOrder(doc)).toEqual([ids[0], ids[2]]);
    expect(readDeckOutline(doc).theme).toBe("ink");
  });

  it("updates only the given fields", () => {
    const { doc, ids } = deck();
    applyDeckOps(doc, [
      { op: "update_slide", id: ids[1], fields: { title: "Shipped **this** quarter" } },
    ]);
    const slide = readDeckOutline(doc).slides[1];
    expect(slide.slots.title).toBe("Shipped **this** quarter");
    expect(slide.slots.body).toContain("- Docs");
    expect(slide.notes).toBe("Keep it short");
  });

  it("applies nothing when a later op is refused", () => {
    const { doc, ids } = deck();
    const before = readDeckOutline(doc);
    expect(() =>
      applyDeckOps(doc, [
        { op: "delete_slide", id: ids[0] },
        { op: "update_slide", id: ids[0], fields: { title: "Gone" } },
      ]),
    ).toThrow(/no slide/);
    expect(readDeckOutline(doc)).toEqual(before);
  });

  it("names the refused op", () => {
    const { doc } = deck();
    try {
      applyDeckOps(doc, [
        { op: "set_theme", theme: "paper" },
        { op: "set_theme", theme: "neon" as never },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DeckOpError);
      expect((error as DeckOpError).index).toBe(1);
    }
  });

  it("keeps to the Space level's slide limit", () => {
    const { doc } = deck();
    expect(() =>
      applyDeckOps(doc, [{ op: "insert_slide", slide: { layout: "bullets" } }], { maxSlides: 3 }),
    ).toThrow(/at most 3/);
  });
});

describe("layout switching", () => {
  it("keeps slots the new layout doesn't use, so switching back restores them", () => {
    const { doc, ids } = deck();
    applyDeckOps(doc, [{ op: "update_slide", id: ids[1], fields: { layout: "section" } }]);
    let slide = readDeckOutline(doc).slides[1];
    expect(slide.layout).toBe("section");
    expect(slide.slots.title).toBe("What shipped");
    expect(slide.kept).toContain("body");
    applyDeckOps(doc, [{ op: "update_slide", id: ids[1], fields: { layout: "bullets" } }]);
    slide = readDeckOutline(doc).slides[1];
    expect(slide.slots.body).toBe("- Docs\n- Slides\n  - Themes\n- Data");
    expect(slide.kept).toEqual([]);
  });

  it("maps body to the left column by role and back", () => {
    const { doc, ids } = deck();
    applyDeckOps(doc, [{ op: "update_slide", id: ids[1], fields: { layout: "two-columns" } }]);
    let slide = readDeckOutline(doc).slides[1];
    expect(slide.slots.left).toContain("- Docs");
    expect(slide.slots.body).toBeUndefined();
    applyDeckOps(doc, [{ op: "update_slide", id: ids[1], fields: { layout: "bullets" } }]);
    slide = readDeckOutline(doc).slides[1];
    expect(slide.slots.body).toContain("- Docs");
  });

  it("creates the new layout's empty text slots for the editor", () => {
    const { doc, ids } = deck();
    applyDeckOps(doc, [{ op: "update_slide", id: ids[0], fields: { layout: "quote" } }]);
    const slots = slideSlots(deckParts(doc).slides.get(ids[0])!)!;
    expect(slots.get("quote")).toBeInstanceOf(Y.XmlFragment);
    expect(slots.get("attribution")).toBeInstanceOf(Y.XmlFragment);
  });

  it("switches a slide with no visual slot to Text + visual when a visual is added", () => {
    const { doc, ids } = deck();
    applyDeckOps(doc, [
      { op: "update_slide", id: ids[1], fields: { visual: { image_asset_id: "a1" } } },
    ]);
    const slide = readDeckOutline(doc).slides[1];
    expect(slide.layout).toBe("text-visual");
    expect(slide.slots.visual).toEqual({ type: "image", asset_id: "a1" });
    applyDeckOps(doc, [{ op: "update_slide", id: ids[1], fields: { visual: null } }]);
    expect(readDeckOutline(doc).slides[1].slots.visual).toBeUndefined();
  });
});

describe("duplicateSlide", () => {
  it("copies every slot and the notes right after the slide", () => {
    const { doc, ids } = deck();
    const copy = duplicateSlide(doc, ids[1]);
    const outline = readDeckOutline(doc);
    expect(outline.slides.map((slide) => slide.id)).toEqual([ids[0], ids[1], copy, ids[2]]);
    expect(outline.slides[2].slots).toEqual(outline.slides[1].slots);
    expect(outline.slides[2].notes).toBe("Keep it short");
  });
});

describe("rich text", () => {
  it("round-trips markdown marks and two bullet levels", () => {
    const markdown =
      "Lead with **bold** and *italic* and [a link](https://misty.dev)\n\n- One\n  - Two\n- Three";
    const doc = new Y.Doc();
    createDeck(doc, { slides: [{ layout: "bullets", body: markdown }] });
    expect(readDeckOutline(doc).slides[0].slots.body).toBe(markdown);
  });

  it("reads plain runs after marked ones without their marks", () => {
    const doc = new Y.Doc();
    createDeck(doc, { slides: [{ layout: "bullets", title: "**Bold** then plain" }] });
    const id = slideIdsInOrder(doc)[0];
    const title = slideSlots(deckParts(doc).slides.get(id)!)!.get("title") as Y.XmlFragment;
    expect(readRichText(title)).toEqual([
      { kind: "paragraph", runs: [{ text: "Bold", bold: true }, { text: " then plain" }] },
    ]);
    expect(richToMarkdown(readRichText(title))).toBe("**Bold** then plain");
  });

  it("drops links that aren't web or mail links", () => {
    expect(markdownToRich("[x](javascript:void)")).toEqual([
      { kind: "paragraph", runs: [{ text: "x" }] },
    ]);
  });
});
