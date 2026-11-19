import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createDeck } from "../deck/model";
import { exportDeckPptx, hex, inches, points, textRuns, type PptxSources } from "./pptx";

const recorded = vi.hoisted(() => ({
  slides: [] as Array<{
    background?: unknown;
    hidden?: boolean;
    texts: Array<{ text: unknown; options: Record<string, unknown> }>;
    images: Array<Record<string, unknown>>;
    charts: Array<{ type: unknown; data: unknown; options: Record<string, unknown> }>;
    notes: string[];
  }>,
  layouts: [] as unknown[],
}));

vi.mock("pptxgenjs", () => {
  class FakeSlide {
    background?: unknown;
    hidden?: boolean;
    texts: Array<{ text: unknown; options: Record<string, unknown> }> = [];
    images: Array<Record<string, unknown>> = [];
    charts: Array<{ type: unknown; data: unknown; options: Record<string, unknown> }> = [];
    notes: string[] = [];
    addText(text: unknown, options: Record<string, unknown>) {
      this.texts.push({ text, options });
      return this;
    }
    addImage(options: Record<string, unknown>) {
      this.images.push(options);
      return this;
    }
    addChart(type: unknown, data: unknown, options: Record<string, unknown>) {
      this.charts.push({ type, data, options });
      return this;
    }
    addNotes(notes: string) {
      this.notes.push(notes);
      return this;
    }
  }
  class FakePptx {
    layout = "";
    title = "";
    company = "";
    defineLayout(layout: unknown) {
      recorded.layouts.push(layout);
    }
    addSlide() {
      const slide = new FakeSlide();
      recorded.slides.push(slide);
      return slide;
    }
    async write() {
      return new Blob(["pptx"]);
    }
  }
  return { default: FakePptx };
});

const sources: PptxSources = {
  fit: (_theme, spec) => ({ size: spec.max, overflow: false }),
  image: async () => "data:image/png;base64,AAAA",
  chart: async () => ({
    type: "column",
    title: "Weekly",
    categories: ["Aug", "Sep"],
    series: [{ name: "Spaces", values: [1200, null] }],
  }),
  frame: async () => null,
};

describe("exportDeckPptx", () => {
  beforeEach(() => {
    recorded.slides.length = 0;
    recorded.layouts.length = 0;
  });

  it("maps each layout onto a 13.333×7.5 in slide with real text boxes", async () => {
    const doc = new Y.Doc();
    createDeck(doc, {
      theme: "paper",
      slides: [
        { layout: "title", kicker: "Q4", title: "Launch review", notes: "Open on the number" },
        { layout: "bullets", title: "Shipped", body: "- Docs\n  - Tables\n- Slides", hidden: true },
      ],
    });
    const blob = await exportDeckPptx(
      { doc, spaceId: "s1", deckId: "d1", title: "Launch review" },
      sources,
    );
    expect(blob).toBeInstanceOf(Blob);
    expect(recorded.layouts).toEqual([{ name: "MISTY_16x9", width: 13.333, height: 7.5 }]);
    expect(recorded.slides).toHaveLength(2);

    const [title, bullets] = recorded.slides;
    expect(title.background).toEqual({ color: "F6F1E7" });
    expect(title.notes).toEqual(["Open on the number"]);
    const heading = title.texts.find((text) => text.options.fontFace === "Fraunces");
    expect(heading?.options).toMatchObject({
      fontSize: 64,
      bold: true,
      color: "2B2622",
      valign: "bottom",
      margin: 0,
    });
    expect(heading?.options.x).toBeCloseTo(136 / 144, 2);
    const kicker = title.texts.find(
      (text) => text.text !== "Launch review" && text.options.fontFace === "Inter",
    );
    expect(kicker?.options.color).toBe("C0573A");

    expect(bullets.hidden).toBe(true);
    const body = bullets.texts.find(
      (text) =>
        Array.isArray(text.text) &&
        text.text.some((run: { options?: { bullet?: boolean } }) => run.options?.bullet),
    );
    expect(body?.text).toEqual([
      { text: "Docs", options: { bullet: true, indentLevel: 0, breakLine: true } },
      { text: "Tables", options: { bullet: true, indentLevel: 1, breakLine: true } },
      { text: "Slides", options: { bullet: true, indentLevel: 0 } },
    ]);
    // The footer: the deck's title and the slide's number.
    expect(bullets.texts.some((text) => text.text === "2")).toBe(true);
  });

  it("turns Data charts into native charts and images into pictures", async () => {
    const doc = new Y.Doc();
    createDeck(doc, {
      slides: [
        {
          layout: "text-visual",
          title: "Growth",
          visual: { data_chart: { item_id: "wb", part_id: "c", title: "Weekly" } },
        },
        { layout: "full-visual", visual: { image_asset_id: "a1", focal_x: 0.2 } },
      ],
    });
    await exportDeckPptx({ doc, spaceId: "s1", deckId: "d1", title: "Deck" }, sources);
    const [chartSlide, imageSlide] = recorded.slides;
    expect(chartSlide.charts).toHaveLength(1);
    expect(chartSlide.charts[0].type).toBe("bar");
    expect(chartSlide.charts[0].data).toEqual([
      { name: "Spaces", labels: ["Aug", "Sep"], values: [1200, 0] },
    ]);
    expect(chartSlide.charts[0].options).toMatchObject({
      barDir: "col",
      showTitle: true,
      title: "Weekly",
    });
    expect(imageSlide.images).toEqual([
      expect.objectContaining({ data: "data:image/png;base64,AAAA", x: 0, y: 0, w: 13.333 }),
    ]);
  });

  it("names a part it couldn't read where it would be", async () => {
    const doc = new Y.Doc();
    createDeck(doc, {
      slides: [
        {
          layout: "visual-text",
          title: "Flow",
          visual: { board_frame: { item_id: "dr", part_id: "f", title: "Flows" } },
        },
      ],
    });
    await exportDeckPptx({ doc, spaceId: "s1", deckId: "d1", title: "Deck" }, sources);
    expect(recorded.slides[0].texts.some((text) => text.text === "Flows")).toBe(true);
  });
});

describe("pptx mapping", () => {
  it("converts frame pixels to inches and points", () => {
    expect(inches({ x: 144, y: 72, w: 1920, h: 1080 })).toEqual({
      x: 1,
      y: 0.5,
      w: 13.333,
      h: 7.5,
    });
    expect(points(44)).toBe(22);
  });

  it("writes colors as six digit hex", () => {
    expect(hex("#abc")).toBe("AABBCC");
    expect(hex("#191919")).toBe("191919");
    expect(hex("var(--x)")).toBe("888888");
  });

  it("keeps marks and links on their runs", () => {
    expect(
      textRuns([
        {
          kind: "paragraph",
          runs: [{ text: "Read " }, { text: "this", bold: true, href: "https://misty.dev" }],
        },
      ]),
    ).toEqual([
      { text: "Read " },
      { text: "this", options: { bold: true, hyperlink: { url: "https://misty.dev" } } },
    ]);
  });
});
